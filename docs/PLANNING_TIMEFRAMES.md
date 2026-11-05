# Planning timeframes and source tasks — 0.4.0 release candidate

## Lifecycle and responsibilities

The updated path is authorized source content → source-backed task suggestions → customer ownership/fact review → accepted profile-owned tasks → scoped effort estimate → deterministic draft within working hours → review and Apply → optional measured-effort feedback.

The workflow owns permissions, quotas, validation, source/task revisions, scheduling and writes. The agent interprets authorized text. Duration estimation is a separate, versioned calculation; a model cannot expand source permissions or write calendar events. Existing diary summaries keep their diary citation boundary.

## 1. Working hours

Settings and onboarding share WorkingCalendarEditor. New profiles start with Monday–Friday 09:00–12:30 and 14:00–18:00, weekends off. Existing daily intervals are preserved; enabling weekly rules from legacy settings copies all their intervals rather than silently choosing new days. Multiple intervals reserve breaks; dated exceptions can mark holidays or explicit working days. Empty intervals mean no capacity.

workingCalendar.cjs validates and resolves rules to the existing allocator's input. Per-analysis hours intersect the working calendar, so a broad override cannot bypass lunch or a day off. Use a reviewed date exception to work outside normal hours. Existing timezone/DST validation still applies. Settings revisions invalidate reviewed drafts, and Apply rechecks the working-hour result.

DurationControl pairs a native slider and exact numeric input. In diary Plan, save task facts and choose Recalculate draft from saved task facts to run the deterministic allocator without another AI request. The original interpretation is retained. Applied events are not moved. In Tasks, save durations and prepare a new selected-task draft.

## 2. Tasks independent of a diary

SQLite schema 4 removes the journal foreign-key deletion cascade from durable_tasks and preserves task IDs, analysis/session links and receipts. It adds source_items, task_sources, task_candidates, effort_records and task_plans. Accepted tasks may have several source links. Source-task plans use bundle contract 2, reusing the established validated task/evidence/estimate record shapes; saved diary analyses remain contract 1 and keep legacy read/replay behavior.

sourceTasks.cjs owns profile-scoped storage, exact source snapshots and candidate identities, review, source-plan creation, stale checks, Apply/replay and outcomes. sourceRoutes.cjs exposes the authenticated API. Source-only plans require no persistent diary. One source can support several actions; repeated unchanged captures do not create extra candidates. Linking a candidate to an existing task is an explicit customer merge, not automatic title similarity.

Source changes return accepted candidates to review and prevent old source versions from being planned/applied. Completed/cancelled task status still requires review. Revoking a source removes its raw content and scrubs copied candidate/plan quotes while retaining accepted task identity and existing calendar events. A task with other readable sources can be replanned using those; an orphan needs readable evidence before planning.

Task inbox: add selected email/document/app text, or connect a source; inspect evidence, accept/dismiss or link a suggestion; review deadline/scope/status; select tasks; prepare and inspect the draft; Apply explicitly. Selected-source import is a usable fallback before real provider setup. All source content remains local unless the customer enables the separate per-discovery AI option.

## 3. Gmail

gmail.cjs reuses the state/PKCE/loopback OAuth and encrypted-token implementation with its own scopes and storage namespace. Calendar tokens and busy-cache state are not replaced. Gmail access is read-only and needs its own customer consent; existing Calendar consent is insufficient. A public Gmail connector needs Google's applicable restricted-scope review, including assessment of any remote-model data flow.

Initial sync is bounded; subsequent sync uses history cursors, with expired-cursor recovery. The selectable folder/date window, pagination limits, thread-context limits and normalized-message-text coverage are disclosed. Plain-text parts are preferred; HTML-only bodies are converted to inert text with scripts/styles removed and entities decoded. Attachments are excluded. Large batches fail visibly rather than silently claiming a complete sync. Thread context retains per-message timestamps so a relative date is anchored to its own message, not another reply.

Local source changes/deletions invalidate old drafts. Disconnect is local: automatically revoking the shared Google application grant could also invalidate Calendar, so the app explains the distinction instead of doing that silently. Losing account permission does not establish that a task was completed.

Real Gmail consent/sync is a customer setup/acceptance step. Development verification uses mocked mail and synthetic tokens, not the existing personal account.

## 4. Windows work-app capture

workCapture.cjs launches the bundled windows-work-content.ps1 helper with a hidden console. Capture begins paused and is limited to a customer-selected process/window handle. It reads accessible UI text every minute, skips password/offscreen controls and excluded credential-manager apps, and shows status/errors. Only local rule discovery runs automatically on newly captured text; sending text to the configured AI needs the separate choice.

UI Automation is preferred. Optional local OCR requires the selected window to be foreground, supported Windows OCR components/languages and a usable window region. OCR uses an in-memory image stream and does not save screenshot files. Inaccessible, minimized or unsupported apps return a visible failure rather than fabricated content. A screen/window snapshot does not cover unseen messages or all work on the computer.

The app does not navigate other programs or grant permissions. Pause stops future reads and terminates an active helper. Closing/switching the profile closes capture/OAuth resources and cancels stale results. On non-Windows systems capture reports unavailable. asarUnpack includes the helper, and package validation checks its presence and the source runtime.

A native hidden synthetic textbox verifies actual Windows UI Automation without reading personal windows. Arbitrary customer apps, native OCR accuracy and real multi-monitor/occlusion behavior still require target-app acceptance. The existing foreground-app/idle sampler is unchanged and is not used as a duration label.

## 5. Estimation and actual effort

effortEstimator.cjs implements history-shrinkage-v1:

    residual_i = ln(actualActiveMinutes_i / originalBaseline_i)
    weight_i = 2 ^ (-ageDays_i / 180)
    evidenceWeight = sum(weight_i)
    prediction = baseline * exp(evidenceWeight/(evidenceWeight+5) * weightedMedian(residual_i))

Work details in task review can record category, quantity/unit, revision versus creation, complexity and familiarity. Unknowns remain blank. Complete reviewed descriptors enable the later model; incomplete descriptors keep conservative task-specific matching. Customers can choose the history-informed estimate or fix a selected duration. Separate baselines are retained for session versus total remaining work.

It uses completed, compatible, earlier outcomes, deduplicates repeated outcomes for one task/scope generation and discounts old data. Original baselines are kept separate from customer planning overrides. A matching category, scope, unit and baseline version is required; the initial adapters use conservative title-based unit identities rather than assuming arbitrary similar-looking tasks are comparable. There is no cross-customer training.

No history preserves the scoped baseline. Local source extraction leaves duration unknown rather than assigning a keyword duration to every email. The customer can provide a baseline and work scope; authorized AI extraction may supply an explicitly tentative session estimate. Missing essential scope remains a clarification/unknown. Ranges are provisional, not calibrated probabilities. Diary task reconciliation and source-task planning can both apply measured-history correction.

Tasks offers Start/Resume and Pause on the current screen plus manual active-total entry tied to an original plan snapshot. The timer is an on-screen aid; pause before leaving it, and review/enter the total before saving. Completion refers to the same estimated scope, not automatically the entire project. Incomplete outcomes do not train total completion effort. Saving the same receipt replays rather than counting twice. Calendar length, app foreground time and slider changes are never actual-work labels.

evaluation/effort/train.py is a separate optional CatBoost challenger, not a production dependency. Install its pinned requirements in an isolated Python environment; use --synthetic --mechanics-only for standard-library partition/label checks, or --synthetic for a model-training mechanics run. Use --workspace-export with an explicit local Account export JSON to consume the app’s completed outcomes. The adapter excludes unreviewed/incomplete descriptors and keeps one outcome per task. Explicit CSV input needs task_id, estimated_at, completed_at, category, unit, revise_or_create, quantity, complexity, baseline, scope and actual_minutes; familiarity may be unknown. Inputs and reports must remain outside Git.

The experiment uses chronological train/validation/calibration/test partitions ordered by estimate time, excluding outcomes that complete across the next partition’s estimate boundary, log-minute targets and Q10/Q50/Q90 regressors, with monotone rearrangement and held-out interval calibration. It compares error/bias/coverage/width against baselines. Synthetic success cannot establish real duration accuracy. No trained model is promoted by this update; promotion requires representative outcomes and a measured win over the deterministic baseline. Python/CatBoost are not required to run the desktop app.

## 6. Versions, checks and recovery

Candidate app 0.4.0-rc.1; SQLite 4; source-plan bundle 2 with diary bundle 1 compatibility; prompt 1.4.0; task-planning skill 1.2.0; daily-summary skill unchanged at 1.1.0; synthetic data 1.3.0; reporting metrics 4.0.0. Prior prompt/skill files remain immutable. The central estimate remains a selected planning estimate; a later quantile model's P50 must not be described as a mathematical mean.

Regression tests cover break boundaries and overrides, legacy settings, source-only tasks, repeated captures, exact evidence, changed-source/task/settings/calendar rejection, hard deadlines, Apply replay, deletion, portable transfer, actual labels, history correction, Gmail token isolation and capture pause. Offline evaluation adds explicitly synthetic timeframe mechanics; it does not replace a representative holdout. Desktop IPC smoke includes source-only discovery → acceptance → plan → Apply/replay and task-inbox rendering.

Before upgrading, the existing SQLite snapshot mechanism verifies an intact pre-migration copy. Schema changes run under a writer transaction; v3 task/session data is copied without generating new IDs. Old binaries must refuse schema 4. Restoring code is not a database downgrade: stop the candidate and open a verified schema-3 snapshot at a new explicit profile/database path with the matching older app. Preserve the schema-4 workspace and all post-upgrade work; reconcile/export it before returning to a prior version. Never replace a live profile database with a backup.

All development fixtures are invented. Credentials, captures, personal outcomes, databases, model files and runtime reports are excluded from commits. The installed personal app and original Calendar_App are not upgraded by a branch push or draft PR.

## Local acceptance recorded 2026-11-05

The implementation repository passed 264 JavaScript tests (51 frontend and 213 server), lint, compatibility/private-path gates, offline evaluation including timeframe mechanics, production build, synthetic desktop/auth IPC and browser-cookie proxy smoke. Three standard-library Python training-data tests passed. The pinned CatBoost/NumPy experiment trained and evaluated Q10/Q50/Q90 on 400 invented work packages; this verifies the pipeline and is not a real duration-accuracy result.

The Windows 0.4.0-rc.1 NSIS installer was built without publication. Its unpacked executable passed actual packaged source-only discovery/review/planning/Apply/replay, reviewed-feature timing export, Chinese text/retrieval, restart/duplicate protection, OS-encrypted synthetic service setup, schema migration/snapshot, SQLite integrity and backup/reopen checks. The unpacked native capture helper passed its hidden synthetic textbox test. Runtime verification compared all 73 packaged source files with the reviewed working source.

Installer SHA-256: ef367df22a90c4ea240f36884a06ff471d43fc7ba69f09cb011e181a9295af9e. Authenticode is NotSigned; the default icon remains. This is an unpacked-runtime/installer-build validation, not a clean-machine or installed-personal-app upgrade claim. Hosted CI status is recorded in the draft PR after branch publication.

Remaining acceptance: real Gmail account consent/sync, customer-selected work-app/OCR behavior, representative task-discovery quality and measured-duration holdout accuracy. No personal sources were read for these checks, and no trained personal model is shipped. The original Calendar_App and installed personal app were not upgraded. All 25 original annotation edits remain outside the feature commits.
