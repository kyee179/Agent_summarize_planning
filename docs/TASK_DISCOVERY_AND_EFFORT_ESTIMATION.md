# Task discovery and effort estimation, proposal v0.2

2026-11-05. Clarifies that email and captured work-app content must create new task candidates independently of diary entries. Specifies an implementable estimator and a named trainable model. This is a design specification; no customer capture, account access, model training or application migration has been performed.

## 1. Full lifecycle

Customer-authorized sources → source snapshots → task/ownership extraction → deduplication and update resolution → task inbox → accepted durable tasks → scope normalization → effort estimate → working-hours-constrained draft → customer review and Apply → optional actual-effort feedback.

Task discovery should run when a selected source changes or when the customer selects Refresh tasks. It must not require a diary entry or an already-known task as the search query. Searching for additional evidence about a known task remains a separate operation.

## 2. Discover new tasks across sources

### Inputs and acquisition

| Source | Acquisition | Coverage boundary |
| --- | --- | --- |
| Diary | Existing saved-entry analysis | Only selected/authorized entries |
| Email | Initial bounded mailbox sync, relevant thread reads, incremental changes | Chosen account and app-enforced mailbox/time filters; not every message ever received |
| Task/work system with API | Read assigned items, states, comments and explicit due dates | Authorized workspace/projects; native assignment/status is stronger than inferred screen text |
| Desktop-only app | Customer-enabled capture for selected app windows; UI Automation text first, optional screenshot/vision/OCR fallback | Only captured/exposed content; cannot recover unseen messages or offscreen tasks reliably |

Gmail supports initial/partial synchronization and thread retrieval. Microsoft Graph supports per-folder message delta queries. These make incremental discovery possible without rereading every email for every plan. Expired cursors require provider-specific recovery and a bounded reconciliation scan. Screenshots alone cannot provide equivalent mailbox completeness.

The existing foreground-app sampler does not capture message text. App names/idle periods remain activity context. A separate content-capture component needs selected-app permission, a capture indicator, Pause/Delete controls, content-version deduplication and independently controlled remote-model use. Where an API is available, prefer its stable identifiers and explicit assignment over repeated screen capture.

### Extraction contract

Each candidate should include action, deliverable, owner/assignee, ownership evidence, project, source item ID, distinct action anchor within that item, exact evidence span, source version/time, deadline candidate and precision, observed task state, proposed work scope and uncertainty.

Use a structured language-model extraction pass to recognize requests, assignments, and commitments. Validate that quoted evidence exists in the captured snapshot. Treat source text as untrusted data, including apparent instructions addressed to an AI assistant. Missing owner, missing scope or low-quality OCR is a reason for clarification, not an invented fact. Model self-reported confidence alone is not a reliable acceptance threshold.

An incoming message to the customer is not automatically a personal task. Resolve direct assignment, explicit self-commitment and ambiguous group requests separately. Reading, archiving, or spending time in an app does not establish task completion. Quoted old messages, forwarded requests, cancelled work and requests assigned to someone else need contextual handling.

### Examples, all invented

| Observed content | Proposed behavior |
| --- | --- |
| Email: “Please revise the three charts and send the report by Friday.” | New candidate: revise charts and send report; preserve date-only deadline and verify ownership |
| Board item assigned to the signed-in customer: “Review PR 42” | New candidate backed by the board item's stable ID, even without a diary entry |
| Chat: “Could someone review this?” | Unassigned suggestion requiring ownership clarification |
| Reply: “Ignore the previous request; it is cancelled.” | Proposed update to the linked task; do not silently remove already-applied calendar events |
| Email and chat repeat the same report request | One task with two evidence links after identity is resolved |
| Screen shows only Outlook as the foreground process | No task inference from the process name alone |

### Identity and review

Maintain a profile-scoped task inbox with Suggested / Accepted / Dismissed candidate states, separate from execution states such as open/in_progress/completed. Support batch acceptance and retain dismissal decisions for unchanged source actions. Reviewing tasks and applying calendar events remain separate actions.

First deduplicate exactly by provider/account/source-item/action anchor and revision. Repeated screenshots of the same message should upsert the same candidate. One thread can contain several tasks; a thread ID alone is not a task identity. Cross-source semantic matches are merge suggestions unless stable references or customer confirmation resolve identity. Do not merge tasks solely because their titles sound similar.

New source revisions can propose changed due dates, cancellation or completion without silently replacing confirmed customer facts. Preserve who asserted each value and flag conflicts. Recheck relevant source/task versions before Apply.

## 3. Repository changes required

Current durable_tasks in server/tasks.cjs requires journal_id and uses ON DELETE CASCADE. Identity/reconciliation is scoped to a diary and source keys use journal excerpts. Therefore an email-only task is not a safe drop-in extension to the current diary analysis.

Recommended migration:

1. Make durable tasks profile-owned and independent of journal lifetime. Use source_items and task_sources relations for evidence from journals, email, work-app entities and captures. Preserve all current task IDs, event/session links and receipts.
2. Keep analyses linked to tasks, but allow source-driven discovery runs with no diary. Deleting a diary must not delete an accepted task supported by other sources. Decide retention separately for task identity, evidence payloads and source revocation.
3. Add versioned candidate/ownership/evidence contracts and support multiple action anchors per source item. Update closed schemas and the compact-provider boundary together.
4. Add a source registry, bounded connector cursors and discovery status. The workflow owns access, cancellation, budgets and profile boundaries; the agent interprets source content.
5. Add the task inbox and a planning entry point for accepted tasks across sources. Preserve the existing diary-summary citation boundary: an email task does not make email content part of a diary-only summary.

Back up before schema migration. Regression checks must cover diary deletion, legacy IDs, duplicate captures, multiple actions in one thread, conflicting dates, reassignment/cancellation, cross-profile isolation and no duplicate calendar writes.

## 4. Define what the duration target means

Predict remaining active effort for a specified scope, in minutes. Waiting for another person, elapsed calendar time, task priority and time left before a deadline are separate variables. Do not shorten predicted effort merely because a deadline is near.

Normalize features before estimating: task category/subtype, deliverable, quantity/unit, revise-versus-create, complexity with a rubric, familiarity, tools, acceptance criteria, already-completed scope, and dependencies. Preserve unknowns. An LLM may propose features and a work breakdown, but cannot fill unknown quantities as facts.

Examples: “Revise three existing charts with supplied data” and “Create a report” should not share a generic report duration. Ask a short scope question when a missing quantity or acceptance criterion dominates uncertainty. For open-ended work, offer a bounded discovery session and leave total effort unknown.

Store a frozen estimate-at-start, feature/schema/model version and completion outcome. Explicit customer planning overrides must be stored separately from measured actual effort. Collect actual minutes with a task-linked timer or customer-entered active total, across all relevant sessions. Mark pauses, scope changes and incomplete work. Do not train total-task duration on a half-finished session; do not treat calendar allocation or foreground-app duration as ground truth.

## 5. First algorithm: comparable-history correction with shrinkage

This proposed baseline can run in the existing Node process. It requires no trained neural model and remains inspectable. It is an engineering baseline to evaluate, not an accuracy result or an exact Bayesian posterior.

### Inputs and cold start

- Current baseline B > 0 for the stated scope. Prefer a customer/project work breakdown or a task template with measured per-unit rates; otherwise obtain a tentative breakdown from the current language model.
- Frozen historic unpersonalized baselines B_i and measured active outcomes A_i > 0 for genuinely comparable, completed tasks. B_i is recorded before this correction and before customer overrides, so repeated learning does not compound already-corrected predictions.
- Same profile, compatible category/subtype, scope, deliverable units and baseline model version. Text similarity can retrieve candidates but does not establish comparability by itself. Do not linearly scale units unless that task type's rate model supports it; allow fixed setup effort.

If no valid history exists, retain B and its explicitly uncalibrated range. If scope is insufficient to construct a defensible baseline, return unknown/clarification rather than an arbitrary keyword duration.

### Calculation

For each eligible history item:

    r_i = ln(A_i / B_i)
    w_i = 2 ^ (-ageDays_i / 180)

Then:

    S = sum(w_i)
    c = weightedMedian(r_i, weights=w_i)
    lambda = S / (S + 5)
    predictedMinutes = B * exp(lambda * c)

For no matches use lambda=0 and predictedMinutes=B. Compute the weighted median by sorting residuals and choosing the first whose cumulative weight reaches at least half the total. Each completed task contributes once; many sessions/screenshots must not multiply its weight. Valid but extreme outcomes remain data; the median limits their effect. Exclude erroneous labels through review, not because they make the model look worse.

The 180-day half-life and prior strength 5 are initial product parameters, not empirically established constants. Tune them only on training/validation histories. Unnormalized weights are intentional: uniformly old evidence loses influence rather than regaining a full vote after normalization. Same-version comparisons avoid silently mixing baselines that have different biases.

### Worked example

Suppose the current scoped baseline is 60 minutes, and recent comparable outcomes typically took 1.5 times their frozen baselines. With all examples equally recent:

| Comparable completed tasks | lambda | Prediction before display rounding |
| --- | --- | --- |
| 0 | 0 | 60.0 min |
| 3 | 3/8 | 69.9 min |
| 20 | 20/25 | 83.0 min |
| Very many | Approaches 1 | Approaches 90 min |

These are arithmetic examples, not measured performance. More evidence makes personal correction stronger. A median correction factor below one also permits shorter estimates.

Preserve the raw prediction. Round only the chosen calendar reservation upward to the configured grid, and show that rounding separately. Do not silently cap a large prediction; flag decomposition or a multi-session requirement. A selected 45-minute session for 180 minutes of remaining work does not mean the task is finished in 45 minutes.

### Uncertainty

During cold start, retain a visibly provisional low/high range from the scoped baseline and expand it to contain the corrected central estimate; do not label it an 80% or 90% interval. It can be wrong and needs evaluation.

Once there are enough valid out-of-sample residuals, use split calibration on log minutes. For calibration examples predicted without their outcomes, score abs(ln(actual)-ln(prediction)); select the finite-sample order statistic ceil((m+1)*(1-alpha)) and form prediction * exp(±scoreQuantile). If the required order statistic exceeds m, do not report a finite calibrated interval. Keep model fitting/tuning, calibration and final chronological testing separate. Ordinary conformal guarantees rely on exchangeability and do not automatically hold as a customer's work changes over time or for each task category. Monitor actual coverage and interval width.

## 6. Existing model to evaluate: CatBoostRegressor with quantile loss

My recommended learned challenger is CatBoostRegressor trained on log(active minutes), with structured scope features. CatBoost supports categorical/numerical features and Quantile/MultiQuantile objectives. This is a model family to train on suitable outcomes, not an already-trained universal human-task-duration model.

Start with three quantile regressors, tau = 0.10, 0.50, 0.90. Alternatively evaluate the documented CPU MultiQuantile objective. Minimal training sketch, not production configuration:

```python
from catboost import CatBoostRegressor
import numpy as np

# X_train contains only features known when each estimate was made.
# y_train_minutes contains completed-task active effort, not allocated time.
models = {}
for tau in (0.10, 0.50, 0.90):
    model = CatBoostRegressor(
        loss_function=f"Quantile:alpha={tau}",
        iterations=300, depth=4, learning_rate=0.05,
        random_seed=42, verbose=False,
    )
    model.fit(X_train, np.log(y_train_minutes),
              cat_features=categorical_columns,
              eval_set=(X_validation, np.log(y_validation_minutes)),
              early_stopping_rounds=30)
    models[tau] = model

# Predict new rows; exponentiation returns minutes.
raw = {tau: np.exp(model.predict(X_new)) for tau, model in models.items()}
```

This illustrates the API and target; dependencies, feature preparation, hyperparameters and deployment still require implementation and evaluation. No Python component is currently installed by this proposal. Use small-model regularization and held-out validation; do not conclude that a particular number of labels guarantees a useful model.

The output is three estimated conditional quantiles. The median is not the mathematical mean. Before assigning them to the current low/expected/high contract, version or explicitly define the central-value semantics; do not silently relabel P50 as expected effort. If independently fitted quantiles cross, apply an evaluated monotone rearrangement and calibrate after that operation. Calibrate interval widths with held-out outcomes; the Q10–Q90 span is an 80% target interval, not a promised 80% result.

Features should include category, units/quantity, revise/create, known remaining scope, complexity/familiarity, tool, relevant past statistics computed using earlier data only, and baseline work-breakdown estimate. Avoid deadline pressure as a mechanism for shrinking required effort. Raw customer identities and private source text are unnecessary features in a local per-profile model.

Do not add independently predicted subtask P90 values and label their sum task P90. Shared complexity and correlated overruns require task-level outcome training or a validated joint simulation. First target one scoped task/work package and store actuals at that same level.

Deploy only after the challenger beats current keyword/model estimates and the history-correction baseline on representative held-out data. For the Electron product, initially evaluate Python locally outside the app. Production inference could use a packaged, versioned local helper or a supported native deployment path; benchmark startup, latency, installer size and model-update/rollback behavior before adding that dependency. CatBoost documents model export to standalone Python/C++, but integration is not automatic.

No shared cross-customer training is implied. Training data and derived personal model files should remain in the authorized profile and out of Git; pooled training would be a separate data product decision. A cold new profile falls back to scoped baselines unless an explicitly authorized and representative population model exists.

## 7. Evaluation and delivery

Evaluate by time order and keep all snapshots/sessions of the same task in one partition. Keep inference-time feature snapshots to prevent leakage from final task text, completion status, future history or customer overrides made after the estimate. For a population model, add user-held-out tests.

Report median/mean absolute error in minutes, signed bias, relative/log error, pinball loss for each quantile, interval coverage and interval width. Break out task types, cold-start/sparse-history cases and revised scopes. Rejected/cancelled work can measure discovery precision but does not provide a completed-effort label. Report the fraction without a valid timing label; complete-case labels can be selective.

Discovery evaluation needs separate precision/recall for personal actionable work, ownership errors, duplicate rate, correct cancellations/updates, deadline extraction and evidence fidelity, including Chinese/mixed content. Use synthetic sources for mechanics, then representative consented examples for actual quality assessment. Synthetic arithmetic can validate the estimator's implementation, not its real accuracy.

Delivery order: source-independent task ownership and inbox → selected-source ingestion and one work/email connector → scoped baselines plus frozen actual-effort collection → history correction → CatBoost challenger experiment → promotion only if it improves measured results. Keep the working-calendar and slider work from the original proposal.

## Primary references

- [Gmail synchronization](https://developers.google.com/workspace/gmail/api/guides/sync)
- [Gmail threads](https://developers.google.com/workspace/gmail/api/guides/threads)
- [Microsoft Graph message changes](https://learn.microsoft.com/en-us/graph/delta-query-messages)
- [Windows UI Automation](https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32)
- [CatBoost regression objectives](https://catboost.ai/docs/en/concepts/loss-functions-regression)
- [CatBoost feature support](https://catboost.ai/docs/en/features/categorical-features)
- [CatBoostRegressor](https://catboost.ai/docs/en/concepts/python-reference_catboostregressor)
- [CatBoost export to Python/C++](https://catboost.ai/docs/en/features/export-model-to-python)
- [Conformalized Quantile Regression, Romano, Patterson and Candes](https://arxiv.org/abs/1905.03222)
