"""Offline challenger experiment. Personal input/output/model files must stay outside Git."""
import argparse
import csv
import json
import math
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path


FEATURES = ["category", "unit", "revise_or_create", "quantity", "complexity", "baseline", "scope", "familiarity"]
CATEGORICAL = [0, 1, 2, 6, 7]


def synthetic_rows():
    rng = random.Random(42)
    rows = []
    for index in range(400):
        quantity = rng.randint(1, 8)
        complexity = rng.randint(1, 3)
        baseline = 15 + quantity * 10
        actual = max(1, round((15 + quantity * 8 * complexity) * rng.uniform(.8, 1.2)))
        started = datetime(2030, 1, 1, tzinfo=timezone.utc) + timedelta(days=index)
        rows.append({"task_id": f"invented-{index}", "estimated_at": started.isoformat(),
                     "completed_at": (started + timedelta(minutes=actual)).isoformat(),
                     "category": "chart", "unit": "chart", "revise_or_create": "revise",
                     "quantity": quantity, "complexity": complexity, "baseline": baseline,
                     "actual_minutes": actual, "scope": "remaining_task", "familiarity": "3"})
    return rows


def validate(rows):
    seen = set()
    for row in rows:
        if row["task_id"] in seen:
            raise ValueError("One completed scoped outcome per task is required; group sessions first")
        seen.add(row["task_id"])
        for key in ("quantity", "complexity", "baseline", "actual_minutes"):
            row[key] = float(row[key])
            if not math.isfinite(row[key]) or row[key] <= 0:
                raise ValueError(f"Invalid positive feature/label: {key}")
        for key in ("estimated_at", "completed_at"):
            instant = datetime.fromisoformat(row[key].replace("Z", "+00:00"))
            if instant.tzinfo is None:
                raise ValueError("Estimate and completion timestamps need explicit timezones")
        if datetime.fromisoformat(row["estimated_at"].replace("Z", "+00:00")) > datetime.fromisoformat(row["completed_at"].replace("Z", "+00:00")):
            raise ValueError("An outcome cannot precede its estimate")
        if row["scope"] not in ("next_session", "remaining_task"):
            raise ValueError("Each outcome needs its original estimated scope")
        row["familiarity"] = str(row.get("familiarity") or "unknown")
        if row["familiarity"] not in ("1", "2", "3", "unknown"):
            raise ValueError("Familiarity is a reviewed category or unknown")
    return sorted(rows, key=lambda row: datetime.fromisoformat(row["estimated_at"].replace("Z", "+00:00")))


def from_workspace(snapshot):
    latest = {}
    for item in snapshot.get("outcomes", []):
        features = item.get("features", {})
        if not item.get("completed") or not features.get("reviewed") or not features.get("complete") or not item.get("estimatedAt"):
            continue
        key = item["taskId"]
        if key not in latest or item["completedAt"] > latest[key]["completed_at"]:
            latest[key] = {"task_id": key, "estimated_at": item["estimatedAt"], "completed_at": item["completedAt"],
                           "category": features["category"], "unit": features["unit"], "revise_or_create": features["revise_or_create"],
                           "quantity": features["quantity"], "complexity": features["complexity"], "scope": features["scope"], "familiarity": features.get("familiarity") or "unknown",
                           "baseline": item["baseline"], "actual_minutes": item["actualMinutes"]}
    return list(latest.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--synthetic", action="store_true")
    source.add_argument("--data", type=Path, help="Explicit consented completed-outcome CSV outside Git")
    source.add_argument("--workspace-export", type=Path, help="Explicit local account-export JSON; only complete reviewed outcomes are used")
    parser.add_argument("--output", type=Path, help="Optional report outside Git; raw labels are never printed")
    parser.add_argument("--mechanics-only", action="store_true")
    args = parser.parse_args()
    if args.data:
        with args.data.open(encoding="utf-8-sig", newline="") as stream:
            rows = validate(list(csv.DictReader(stream)))
    elif args.workspace_export:
        rows = validate(from_workspace(json.loads(args.workspace_export.read_text(encoding="utf-8-sig"))))
    else:
        rows = validate(synthetic_rows())
    if len(rows) < 80:
        raise ValueError("This experiment requires at least 80 rows to form four partitions; this is a mechanics minimum, not an accuracy guarantee")
    cuts = [int(len(rows) * ratio) for ratio in (.5, .65, .8)]
    train, validation, calibration, test = rows[:cuts[0]], rows[cuts[0]:cuts[1]], rows[cuts[1]:cuts[2]], rows[cuts[2]:]
    before_gap = sum(map(len, (train, validation, calibration, test)))
    def finished_before(items, boundary):
        cutoff = datetime.fromisoformat(boundary[0]["estimated_at"].replace("Z", "+00:00"))
        return [item for item in items if datetime.fromisoformat(item["completed_at"].replace("Z", "+00:00")) < cutoff]
    train = finished_before(train, validation)
    validation = finished_before(validation, calibration)
    calibration = finished_before(calibration, test)
    if min(map(len, (train, validation, calibration, test))) < 5:
        raise ValueError("Not enough non-overlapping task outcomes to form leakage-free partitions")
    report = {"experiment": "catboost-effort-quantiles-v1", "synthetic_only": args.synthetic,
              "partitions": dict(zip(("train", "validation", "calibration", "test"), map(len, (train, validation, calibration, test)))),
              "overlapping_outcomes_excluded": before_gap - sum(map(len, (train, validation, calibration, test))),
              "production_model_promoted": False, "real_accuracy_evaluated": False,
              "external_dataset_evaluated": bool(args.data or args.workspace_export) and not args.mechanics_only,
              "representativeness_reviewed": False}
    if args.mechanics_only:
        report["status"] = "partition_and_label_mechanics_passed; model_not_trained"
    else:
        import numpy as np
        from catboost import CatBoostRegressor
        def x(items):
            return [[item[key] for key in FEATURES] for item in items]
        def y(items):
            return np.log([item["actual_minutes"] for item in items])
        models = {}
        for tau in (.1, .5, .9):
            model = CatBoostRegressor(loss_function=f"Quantile:alpha={tau}", iterations=300,
                                      depth=4, learning_rate=.05, random_seed=42, verbose=False,
                                      allow_writing_files=False)
            model.fit(x(train), y(train), cat_features=CATEGORICAL,
                      eval_set=(x(validation), y(validation)), early_stopping_rounds=30)
            models[tau] = model
        def prediction(items):
            # Monotone rearrangement is applied before calibration and evaluation.
            return np.sort(np.column_stack([models[tau].predict(x(items)) for tau in (.1, .5, .9)]), axis=1)
        cal = prediction(calibration)
        scores = np.maximum(0, np.maximum(cal[:, 0] - y(calibration), y(calibration) - cal[:, 2]))
        rank = math.ceil((len(scores) + 1) * .8)
        if rank > len(scores):
            raise ValueError("Insufficient calibration outcomes for the requested interval")
        correction = np.sort(scores)[rank - 1]
        pred = prediction(test)
        actual = np.array([item["actual_minutes"] for item in test])
        central = np.exp(pred[:, 1])
        low, high = np.exp(pred[:, 0] - correction), np.exp(pred[:, 2] + correction)
        baseline = np.array([item["baseline"] for item in test])
        report.update({"status": "offline_challenger_only", "baseline_mae_minutes": float(np.mean(abs(actual - baseline))),
                       "challenger_mae_minutes": float(np.mean(abs(actual - central))),
                       "bias_minutes": float(np.mean(central - actual)),
                       "target_interval_coverage": .8, "observed_interval_coverage": float(np.mean((actual >= low) & (actual <= high))),
                       "mean_interval_width_minutes": float(np.mean(high - low)),
                       "coverage_note": "Exchangeability and future/customer-specific coverage are not guaranteed by a chronological split."})
        report["pinball_log_minutes"] = {str(tau): float(np.mean(np.maximum(tau * (y(test) - pred[:, index]), (tau - 1) * (y(test) - pred[:, index])))) for index, tau in enumerate((.1, .5, .9))}
        # Compare the personalized baseline using only previous training outcomes in the same class.
        def personalized_prediction(item):
            at = datetime.fromisoformat(item["estimated_at"].replace("Z", "+00:00"))
            compatible = [old for old in train if all(old[key] == item[key] for key in ("category", "unit", "scope", "quantity", "complexity", "revise_or_create", "familiarity"))]
            residuals = sorted((math.log(old["actual_minutes"] / old["baseline"]),
                                2 ** (-((at - datetime.fromisoformat(old["completed_at"].replace("Z", "+00:00"))).total_seconds() / 86400) / 180)) for old in compatible)
            weight = sum(w for _, w in residuals)
            cumulative, correction = 0, 0
            for residual, w in residuals:
                cumulative += w
                if cumulative >= weight / 2:
                    correction = residual
                    break
            return item["baseline"] * math.exp(weight / (weight + 5) * correction)
        personalized = np.array([personalized_prediction(item) for item in test])
        report["history_baseline_mae_minutes"] = float(np.mean(abs(actual - personalized)))
    encoded = json.dumps(report, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)


if __name__ == "__main__":
    main()
