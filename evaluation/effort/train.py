"""Offline challenger experiment. Personal input/output/model files must stay outside Git."""
import argparse
import csv
import json
import math
import random
from pathlib import Path


FEATURES = ["category", "unit", "revise_or_create", "quantity", "complexity", "baseline"]
CATEGORICAL = [0, 1, 2]


def synthetic_rows():
    rng = random.Random(42)
    rows = []
    for index in range(400):
        quantity = rng.randint(1, 8)
        complexity = rng.randint(1, 3)
        baseline = 15 + quantity * 10
        rows.append({"task_id": f"invented-{index}", "completed_at": f"{index:04d}",
                     "category": "chart", "unit": "chart", "revise_or_create": "revise",
                     "quantity": quantity, "complexity": complexity, "baseline": baseline,
                     "actual_minutes": max(1, round((15 + quantity * 8 * complexity) * rng.uniform(.8, 1.2)))})
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
        if not row["completed_at"]:
            raise ValueError("Completion order is required")
    return sorted(rows, key=lambda row: row["completed_at"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--synthetic", action="store_true")
    source.add_argument("--data", type=Path, help="Explicit consented completed-outcome CSV outside Git")
    parser.add_argument("--output", type=Path, help="Optional report outside Git; raw labels are never printed")
    parser.add_argument("--mechanics-only", action="store_true")
    args = parser.parse_args()
    if args.data:
        with args.data.open(encoding="utf-8-sig", newline="") as stream:
            rows = validate(list(csv.DictReader(stream)))
    else:
        rows = validate(synthetic_rows())
    if len(rows) < 80:
        raise ValueError("This experiment requires at least 80 rows to form four partitions; this is a mechanics minimum, not an accuracy guarantee")
    cuts = [int(len(rows) * ratio) for ratio in (.5, .65, .8)]
    train, validation, calibration, test = rows[:cuts[0]], rows[cuts[0]:cuts[1]], rows[cuts[1]:cuts[2]], rows[cuts[2]:]
    report = {"experiment": "catboost-effort-quantiles-v1", "synthetic_only": args.synthetic,
              "partitions": dict(zip(("train", "validation", "calibration", "test"), map(len, (train, validation, calibration, test)))),
              "production_model_promoted": False, "real_accuracy_evaluated": not args.synthetic and not args.mechanics_only}
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
        # Compare the personalized baseline using only previous training outcomes in the same class.
        ratios = [math.log(item["actual_minutes"] / item["baseline"]) for item in train]
        correction_ratio = sorted(ratios)[len(ratios) // 2]
        personalized = baseline * math.exp(len(train) / (len(train) + 5) * correction_ratio)
        report["history_baseline_mae_minutes"] = float(np.mean(abs(actual - personalized)))
    encoded = json.dumps(report, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)


if __name__ == "__main__":
    main()
