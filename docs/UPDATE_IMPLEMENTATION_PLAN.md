# Planning update: implementation and version-control plan

Status: approved by the user on 2026-11-05. Implementation proceeds on codex/planning-timeframes.

The user approved this plan after review. Its implementation, scoped commits and feature-branch publication/draft-PR permissions are active; merge, release publication and personal-source consent remain separate.

## 1. Scope and approval boundary

Deliver an update that:

1. Uses customer-editable weekly working hours, breaks and date exceptions as enforced scheduling constraints.
2. Discovers new tasks from diaries, email and authorized captured work-app content, even when no diary exists.
3. Shows source-backed ownership/deadline candidates, deduplicates repeated observations and supports customer review in a task inbox.
4. Estimates scoped active effort using a defined, versioned baseline/history algorithm, offers a slider plus exact input, and records optional measured outcomes.
5. Supplies a reproducible CatBoost quantile experiment without claiming a trained or improved production model before evidence supports it.

The first mail provider is Gmail, building on the existing Google connection infrastructure while keeping Calendar and Gmail grants separate. Work-app coverage begins with Windows selected-app/window capture through UI Automation plus a local OCR fallback where technically supported. The collector must expose unsupported/incomplete capture states; it must not imply that every desktop app or unseen task is readable. Specific work-app APIs and Outlook are later adapters using the same source interface, rather than prerequisites for this update.

Approval of this plan will authorize implementation of the stages below, a new feature branch, scoped local commits, and pushing that branch/opening a draft PR after local checks pass. It includes the current baseline history described below. It will not authorize merging, force-pushing, release tags/publication, upgrading the user's installed app, accessing personal mail/window content, granting new account scopes, or using personal data for model training. Build and test the connectors/capture path with invented data first; actual account consent and selected-app capture remain explicit customer actions.

Do not pause for routine implementation choices within the approved design. Ask only for genuinely missing credentials/account consent, a specific unsupported-app decision that changes scope, an unresolved user-edit conflict, or a materially different design. Explain the reason and continue independent work when possible.

## 2. Verified starting point

Read-only Git inspection on 2026-11-05:

- Repository: D:/project/Agent_summarize_planning.
- Branch: codex/frontend-redesign.
- HEAD: 07e96e8c92823fea7a6755a8c72f33d96b6a28c3, test: validate Windows installer and document downloads.
- Local upstream-tracking comparison: 0 behind, 2 ahead. This is not a fresh remote-server comparison; fetch and recheck after approval.
- The two local commits are e4a973e (hosted login/onboarding) and 07e96e8 (installer validation/download documentation). The new branch inherits them; its eventual PR must disclose these earlier included changes where they are absent from the target.
- Exactly 25 modified tracked server files; the brief identifies these as existing user annotations. Their semantic/comment-only status will be reverified and recorded before edits.
- Index empty. No attached alternative worktree was returned by the desktop app.
- App 0.3.0, SQLite schema 3, planning contract 1, prompt policy 1.3.0, task-planning skill 1.1.0, dataset 1.2.0, metrics 3.0.0.

The historical brief reports 230 passing tests. That is historical evidence, not a test run performed for this planning task. Reestablish the baseline after approval.

## 3. Architecture and execution order

The workflow continues to own permissions, budgets, validation, task/source versions, deterministic allocation and calendar writes. The agent extracts meaning, ownership, scope and evidence-backed candidates. The estimator predicts active effort; the scheduler chooses permitted calendar sessions. Customer review precedes calendar writes.

| Stage | Deliverable and engineering reason | Acceptance checkpoint |
| --- | --- | --- |
| 0. Baseline and branch | Record HEAD, index/worktree state, tracked-source hashes and original annotation changes; create codex/planning-timeframes from the verified current HEAD in the existing checkout | Baseline checks recorded; no unrelated edits staged or discarded |
| 1. Data and contracts | Profile-owned tasks, source/task relations, candidate inbox records, estimate snapshots/outcomes and working-calendar settings; backward-compatible read adapters and atomic migration | Synthetic v3 upgrade and rollback rehearsal preserve task IDs, sessions, events, accounts and receipts; deleting a diary cannot delete a task supported elsewhere |
| 2. Working hours and duration controls | Shared onboarding/Settings weekly editor; breaks/weekends/exceptions; visible plan hours; slider/exact input; deterministic replan endpoint | No forbidden-hour overlaps, no silent shortening, changes invalidate old previews, existing applied events stay fixed |
| 3. Source-driven task discovery | General source snapshots and bounded extraction run without a diary; ownership/evidence validation; exact deduplication; reviewable merges/updates; task inbox and planning entry point | Email-only/work-app-only tasks work end to end using invented sources; repeated observations do not duplicate tasks; summary citations remain correctly scoped |
| 4. Gmail adapter | Separate read-only connect/disconnect state; bounded initial and incremental sync; thread context, cursors, revocation, clear coverage/status; encrypted credentials reuse | Mocked OAuth/sync/error/cancellation tests pass; no existing Calendar token/scope state is silently replaced; real consent deferred until the customer chooses it |
| 5. Windows work-app content | Selected-window UI Automation collector; controlled local OCR fallback; capture indicator, pause/delete, timestamp/source identity, redaction/exclusions and separate AI-use choice | A synthetic local work-app fixture creates a task through the actual helper; repeat capture deduplicates it; excluded/paused windows are not read; helper lifecycle and packaging pass |
| 6. Estimation and feedback | Scoped work-package extraction; cold-start baseline; history correction; optional Start/Pause/Finish/manual actuals; unchanged original estimate plus separately stored customer adjustment; CatBoost offline experiment | Arithmetic and outcome-label gates pass; no history still works; customer duration overrides are not actual-time labels; experiment reports honest baseline comparisons |
| 7. Integrated validation and handoff | Cross-source planning, stale-source/task/settings rechecks, version/prompt pins, walkthroughs, CI and Windows installer validation | Current release checks plus added regression/quality gates pass; draft PR documents scope, evidence, limitations and recovery |

Each stage ends with a concise explanation for the user: lifecycle change, relevant code responsibilities, why the design was chosen, tests performed and remaining limits. After approval, those checkpoints are progress reports, not repeated permission requests.

## 4. Data migration and source semantics

Plan one transactional schema-3-to-schema-4 migration with an automatic pre-migration snapshot and an updated maximum-schema/recovery inspector. Final table names can follow repository conventions, but the model needs:

- Durable tasks owned by a profile, independently of any diary's lifetime.
- Source items with provider/account identity, external ID, version, timestamp, content/locator and authorization scope reference.
- Many-to-many task/source evidence, with distinct actions within a single source item.
- Suggested/accepted/dismissed candidates and reviewable source updates, separate from execution status.
- Frozen estimate/feature/model snapshots and task-linked active-effort outcomes.
- Versioned working-calendar settings and dated exceptions, resolved to scheduler input for each target date.

Preserve existing durable IDs and all session/event/analysis links. Adopt existing journal evidence into source relations. Keep old saved analyses readable through the legacy adapter. Retain applied receipts for idempotent replay; old unapplied drafts must be regenerated when they cannot satisfy new settings/contracts. Do not silently reinterpret old blocks under new effort semantics.

Exact source identity handles repeated sync/capture. A thread can contain multiple tasks. Cross-source similarity proposes a merge; it does not justify merging distinct tasks by title alone. Assignment and source-linked customer commitments determine personal relevance. Read/archived/app-active states do not prove completion. Source text remains untrusted data.

For working-calendar migration, preserve current saved intervals. Do not silently impose weekdays or replace existing evening preferences. New profiles get an editable starter preset of Monday–Friday 09:00–12:30 and 14:00–18:00, weekends off. Empty availability means no work capacity. A per-plan narrowing must not bypass breaks; working outside saved hours requires an explicitly reviewed dated exception.

## 5. Estimator implementation and model experiment

Implement history-shrinkage-v1 in the existing Node server before adding a production ML runtime:

    r_i = ln(actualActiveMinutes_i / originalUnpersonalizedBaseline_i)
    w_i = 2 ^ (-ageDays_i / 180)
    S = sum(w_i)
    correction = weightedMedian(r_i, w_i)
    prediction = baseline * exp((S / (S + 5)) * correction)

With no comparable completed history, retain the scoped baseline and a visibly uncalibrated range. Ask for essential missing scope or offer a bounded investigation session. The half-life and prior strength are versioned starting parameters to tune on validation data. Comparable history must share appropriate scope/category/units and a compatible baseline version. Count each completed task once, not each session or screenshot.

Record the raw estimate before correction/override, actual active effort with provenance, scope changes and completion. Treat waiting as separate from active work. Do not train complete-task effort on incomplete sessions. Round only the calendar reservation, and show it separately from the raw estimate.

Provide a separate, pinned, optional Python CatBoost experiment: structured scope features → log(active minutes) → Q10/Q50/Q90. Keep Node/Electron installation independent of Python/CatBoost for the first production implementation. Check in only training/evaluation code and invented fixtures; personal outcomes, trained personal models and caches stay outside Git. Do not fabricate training labels to claim accuracy.

With no real representative label set yet, completion means a runnable experiment, synthetic mechanics checks and a clear not-yet-evaluated result. Promote a learned model only after representative, authorized chronological evaluation shows improvement over current estimates and history-shrinkage-v1, acceptable bias/interval coverage and deployable inference cost. This data-dependent promotion is not a blocker to delivering the deterministic estimator and outcome collection.

No guaranteed sample threshold is proposed. Keep fitting/tuning, calibration and final test partitions separate, with all versions/sessions of one task in one partition. Q50 is a median, not a mathematical expected value; version central-estimate semantics explicitly. Do not add subtask P90 values and call the sum task P90. The specific algorithm, numerical example and training sketch are in TASK_DISCOVERY_AND_EFFORT_ESTIMATION.md.

## 6. Version control

### Branch and preservation

Use codex/planning-timeframes, based on the current verified HEAD, and reuse the existing checkout. If that branch already exists when implementation begins, inspect it rather than resetting or overwriting it. Before creating it, refresh remote references and inspect divergence. Do not rebase, amend or force-push shared history, merge old development work, or rewrite the two prior commits as a side effect.

Retain the 25 original user edits in the working tree. Save a local, noncommitted baseline diff/hashes. Stage explicit paths and feature hunks only; never use git add . or git add -A. For files containing both original annotations and new code, prepare/review index content independently so only the approved feature delta is committed. Verify original comments/unrelated content and compare executable structure where useful. Do not use reset --hard, clean, or an automatic stash to get a clean tree.

Run a credential/private-path check and inspect the staged diff before every commit. Keep credentials, .env files, OAuth downloads/tokens, captured content/screenshots, journals, real datasets, databases, personal timing history, personal models and runtime reports out of commits. Synthetic fixtures are allowed and must be marked invented. Preserve the dependency lockfile; pin any new helper/experiment dependencies rather than refreshing unrelated packages.

### Commit plan

Use small, coherent, testable commits, with a working application at each retained commit. A data migration and its recovery/regression checks belong together. Split further if a stage is too large; do not split into knowingly broken commits.

| Sequence | Proposed commit message |
| --- | --- |
| 1 | docs: record planning update design and compatibility contract |
| 2 | feat: add profile-owned tasks and source evidence migration |
| 3 | feat: enforce weekly working hours and date exceptions |
| 4 | feat: add duration controls and deterministic draft replanning |
| 5 | feat: discover source-backed tasks in a review inbox |
| 6 | feat: add read-only Gmail task discovery |
| 7 | feat: capture authorized Windows work-app content |
| 8 | feat: record active effort and personalize task estimates |
| 9 | test: add offline quantile estimation experiment and comparisons |
| 10 | test: validate cross-source planning migrations and packaged capture |
| 11 | docs: document planning update setup and recovery |
| 12 | chore: prepare version 0.4.0 release candidate |

These are intended boundaries, not a requirement to create empty/duplicated commits. Regression tests accompany the feature that requires them. The release-candidate commit occurs only when the integrated candidate is actually ready.

### PR and remote workflow

After local integration gates pass, push the new feature branch without force and open a separate draft PR against the appropriate integration target (proposed main). Leave existing PRs unchanged. Review the complete target-to-branch diff first and explicitly identify inherited login/onboarding/installer commits absent from the target; do not present them as newly authored timeframe work.

PR description: concrete resulting customer behavior, implementation boundaries, database/contract changes, source/capture permissions, validation evidence, learned-model status and recovery steps. Wait for hosted CI on that exact PR head, address failures and record the final commit/hash. Do not claim hosted results based only on local tests. If credentials or hosting access are unavailable, finish local work and report precisely what remains unpublished/unverified.

No merge, release tag, GitHub Release, installer deployment or installed-profile migration follows automatically from a draft PR. Those require the user's later release decision.

## 7. Independent version numbers

| Component | Current | Proposed update |
| --- | --- | --- |
| Product | 0.3.0 | 0.4.0-rc.1 for validated candidate; 0.4.0 only at approved stable release |
| SQLite schema | 3 | 4, with snapshot and transactional migration |
| Planning/source contracts | 1 | 2, with explicit legacy read/replay behavior and regenerated affected drafts |
| Working-calendar setting | Legacy interval list | Versioned weekly-calendar format 1 with compatibility adapter |
| Agent prompt policy | 1.3.0 | 1.4.0, new immutable directory and reviewed hash |
| Task-planning instructions | 1.1.0 | 1.2.0; add separate task-discovery 1.0.0 instructions if the phase warrants its own skill |
| Daily-summary instructions | 1.1.0 | Retain unless behavior actually changes |
| Estimator | Keyword/model behavior | history-shrinkage-v1, immutable feature/parameter version and original estimate snapshots |
| Synthetic evaluation data | 1.2.0 | 1.3.0 with discovery, capture and duration mechanics cases |
| Metrics | 3.0.0 | 4.0.0 for new discovery/effort reporting; rerun baselines with the same version |

Update release-policy.json, registry/prompt hashes, generated schemas, compatibility checks and walkthroughs together. Do not edit historical prompt/skill directories in place or lower thresholds to make the new version pass. Compare old/new results under the same model, input corpus, permissions and metric definitions.

## 8. Validation gates

Per stage, run focused meaningful regression tests. At integration, run the current pnpm release:check plus desktop/auth and browser-proxy smoke commands, and inspect the changed UI at desktop and narrow widths. Use temporary invented profiles and databases. Preserve the real Google connection and original Calendar_App installation.

Required added gates:

- Scheduling: zero overlaps with forbidden hours/busy events; correct break boundaries, weekends, exceptions, timezone/DST and stale Apply; no shortening to fit a deadline.
- Storage: v3 migration snapshot, transactional failure recovery, integrity/foreign keys, stable IDs, diary/source deletion semantics, account portability and profile isolation.
- Discovery: supported actionable-task/owner extraction, negation/cancellation, exact evidence, date-only/relative dates, repeated captures, multiple requests per thread, source updates, false-positive handling and review.
- Gmail: separate grants, encrypted tokens, bounded sync/paging, expired-cursor recovery, account switching/revocation, logout cancellation and safe coverage errors.
- Capture: selected app/window identity, no capture while paused/excluded, actual synthetic-fixture text capture, OCR limitations and lifecycle, no accidental content in telemetry and safe helper packaging/shutdown. On non-Windows hosts, test unsupported state and parser fixtures rather than claiming native acceptance.
- Estimation: cold start, scope/units, age weights and correction, invalid/incomplete labels, frozen snapshots, slider/exact-input agreement, no duplicate actuals, calibration/test separation and honest data coverage reporting.
- Existing security/idempotency: source/task/calendar/settings freshness, private-path gate, bounded agent tools, prompt injection cases, preserved receipts and no duplicate writes across restart/retry.

Evaluate discovery quality and duration accuracy separately. Synthetic mechanics cannot establish real task recall or timing accuracy. Holdout data and all live-source tests require representative, consented examples; report unavailable results as unavailable.

Before pushing, audit staged/source content and all original edits. Hosted Windows/Linux CI should run on the draft PR. Validate a Windows 0.4.0-rc.1 installer against a temporary invented profile, including unpacked/installed helper paths and schema migration, without replacing the installed personal app. Increase CI timeout only if measured runtime requires it.

## 9. Rollback and recovery

Code rollback uses revert commits on the feature branch, preserving published history. A commit revert is not a database downgrade.

Before any schema upgrade, create and verify the existing SQLite online snapshot. Old application binaries must refuse schema 4. To return to 0.3.0, stop the candidate and reopen a verified schema-3 snapshot at a new explicit profile/database path; do not overwrite or delete the schema-4 workspace. Any work created after migration remains in the preserved newer profile and needs a compatible export/reconciliation process before restoration. Test this with invented data before release.

Source permissions/capture begin off, and loss of access should be visible. Disabling collection stops helpers and future reads; it must not silently erase accepted tasks or move existing calendar events. Define evidence retention/deletion separately and clearly. Estimator failure falls back to the valid scoped baseline/unknown estimate, never an unvalidated model result.

## 10. What approval means

Approve this plan to begin Stage 0 and continue through the scoped implementation and local validation, followed by feature-branch publication and a draft PR when gates pass. Customer sign-in/capture consent and a final merge/release decision remain separate. CatBoost production promotion remains conditional on real evaluation data; the first delivery includes its experiment and the functioning history-based estimator.

No application files, Git branches, commits, database migrations or remote resources were changed while preparing this plan.
