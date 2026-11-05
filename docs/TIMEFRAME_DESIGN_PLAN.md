# Planning timeframe improvements

Proposal, 2026-11-05. Source review plus an interactive design preview; application code has not been changed.

Revision v0.2: the user clarified that emails and captured work-app content must discover new tasks independently of diaries, and requested a specific estimator/model. See [TASK_DISCOVERY_AND_EFFORT_ESTIMATION.md](TASK_DISCOVERY_AND_EFFORT_ESTIMATION.md) for source-independent task ownership/inbox, an exact history-correction algorithm, a worked example and a CatBoost quantile-regression experiment. Its broader task-discovery scope and detailed estimation design supersede the narrower discussion below; working-calendar and review constraints still apply.

## 1. Clarify the four different times

- Working hours: when a customer permits work to be scheduled.
- Deadline: when a deliverable must be finished, with a cited source or explicit customer confirmation.
- Effort: active work still required, possibly spread over several sessions.
- Calendar session: a chosen block for part or all of that work. Calendar elapsed time is not automatically measured effort.

The lifecycle should be: load the customer's working calendar → retrieve authorized task evidence → interpret task scope and deadline candidates → resolve facts and estimate effort → allocate deterministic sessions → let the customer adjust and review → revalidate and Apply → optionally collect actual effort and improve later estimates.

## 2. What the current code already does

Inspected the implementation at D:/project/Agent_summarize_planning, without opening private configuration, journals, or databases.

| Area | Current implementation | Remaining gap |
| --- | --- | --- |
| Defaults | server/defaults.cjs supplies 20:00–24:00 | An evening preset is unsuitable as a universal working calendar |
| Settings | src/features/SettingsWorkspace.jsx edits multiple defaultAvailability intervals | No weekly day selection or date exceptions |
| Onboarding | src/features/Onboarding.jsx reads and saves one interval | Saving onboarding collapses multiple existing intervals into one; lunch cannot be represented there |
| Scheduling | server/scheduler.cjs subtracts commitments and buffers, fits whole expected sessions, enforces hard deadlines | Weekly rules and explicit nonworking exclusions must be resolved before allocation; session splitting needs a separate policy |
| AI task interpretation | server/agent/compactProposal.cjs has no deadline field and expands every compact task with deadline:null | Improving model tool choice alone cannot transmit a deadline through that path |
| Sources | server/agent/tools.cjs exposes journal evidence, planning context, optional local memory and web snippets | No Gmail/Outlook task-evidence connector; calendar busy intervals omit titles and notes |
| Task facts | server/tasks.cjs reconciles confirmed effort/deadlines; src/components/TaskFacts.jsx provides minute and deadline inputs | Evidence-backed candidates need richer source association; numeric effort editing is hidden in a dialog |
| Local estimates | server/journalAnalyzer.cjs uses keyword buckets; remote compact estimates are low-confidence model ranges | No demonstrated personal-duration calibration |
| Desktop activity | server/integrations/desktopActivity.cjs reads foreground app and idle state only | App use cannot establish a task deadline or actual task effort |

## 3. Working calendar

For new customers, offer an editable starter preset: Monday–Friday, 09:00–12:30 and 14:00–18:00, in the customer's selected timezone; weekends off. Present it during onboarding before the first plan. This is a product starting point, not an assumption about every customer's employment pattern.

Support different hours per weekday, copying hours to other days, multiple intervals, days off, and date exceptions for holidays or a one-off workday. Display a compact weekly view and a plain summary of the hours used by each plan.

Preserve existing customers' saved intervals on upgrade. Do not silently replace evening schedules or infer that their weekends are off. Prompt them to review a weekly template when they next edit preferences. Onboarding and Settings must use the same editor and retain all intervals.

Treat 12:30–14:00 as unavailable. A block may end at 12:30 or start at 14:00; it may not overlap the break. An empty day means no scheduling, never a fallback evening window. Resolve local-clock windows into instants using the selected timezone and existing DST handling.

Effective capacity is working intervals minus date exceptions, explicit breaks, busy events and buffers, clipped by the planning lead time and hard deadline. A per-plan availability control should narrow these hours. Working outside them requires an explicit dated exception that the customer reviews.

Implementation sequence:

1. Add a validated weekly working-calendar setting with a version and exceptions; preserve the legacy intervals through a compatibility adapter.
2. Resolve the chosen date's rules into the scheduler's existing availability intervals. Keep the allocator pure.
3. Include the resolved working-calendar rules and revision in plan freshness checks; recheck them at Apply, including for request-specific availability.
4. Update onboarding, Settings, per-analysis controls, portable import/export, and the plan summary together.

The current allocator plans a target day. A later multi-day planner should repeat date resolution over an explicitly bounded horizon; configuring weekdays alone does not create multi-day planning.

## 4. Find deadlines from evidence

Yes, customer-computer access is technically possible through an installed desktop component, but it needs its own capabilities. This development chat's tools do not automatically become tools in the shipped application.

Prefer these source paths in order:

1. Customer-selected or pasted email, document, or task link. This is the simplest first release and works before account connectors exist.
2. Read-only source connectors: Gmail, Outlook, or the actual task system. Search for the task/project in authorized sources, read matching items and relevant thread updates, and retain evidence.
3. A customer-invoked “Read this window” action for apps without suitable APIs, using Windows UI Automation and, where needed, screenshot/OCR. Scope it to the selected app/window and visible content. It can miss hidden or inaccessible text and needs separate reliability evaluation.

Gmail read-only OAuth is a restricted scope. Public release may need verification, and Google's published rules require a security assessment when restricted data is stored on servers or transmitted. Review the intended remote-model data flow before distributing that connector. Existing Calendar permission does not grant mail access.

Outlook body extraction can use delegated Microsoft Graph Mail.Read for the signed-in user. Mail.ReadBasic excludes bodies and attachments and therefore cannot reliably extract deadlines written there. Mailbox OAuth scopes can be broader than a folder filter: explain both the provider grant and the narrower retrieval filters enforced by our app.

For each deadline candidate retain: task identity, original quoted phrase and exact locator, source ID/version/link, message timestamp, source timezone, parsed date or instant, deadline kind, ambiguity, and confirmation state. Reuse the evidence envelope where possible; version schemas where new source types and date precision require it.

Example synthetic evidence: “Please submit the revised report by Friday, 6 November 2026, 17:00 Asia/Shanghai.” The UI should display that phrase and an Open source action alongside Confirm deadline. A meeting on Friday is not automatically a report deadline. A date-only “by Friday” remains a date-only candidate until an explicit end-of-day policy or customer-selected time resolves it. Relative dates are anchored to the source timestamp, not the day analysis runs. Conflicting or superseded dates need review rather than choosing whichever search result is newest.

The agent should select bounded retrieval tools and propose source-linked candidates. The workflow owns consent, source snapshots, task matching, timezone validation, staleness, and confirmation. Email/document/window text is untrusted data and cannot instruct the agent to expand access or write calendar events. Separate local access permission from permission to send excerpts to the configured remote AI service.

Implementation sequence:

1. Extend the compact proposal and its canonical conversion with optional candidate references and date precision; do not accept a bare model-generated timestamp as evidence.
2. Broaden existing source-relative parsing beyond the current Chinese suggestions and support candidate provenance beyond journals.
3. Add a permission-gated bounded source-retrieval phase with explicit outcomes: searched and matched, no match, unavailable, limit reached, or not authorized. Search can improve recall without guaranteeing a deadline exists.
4. Show candidates and conflicts in task review; promote confirmed values through the existing revision-bound facts path.
5. Add provider connectors one at a time after selected-source import works. Desktop window reading is a later fallback, not a prerequisite for scheduling improvements.

## 5. Better estimates and a duration slider

Use both improved estimation and direct adjustment. A slider improves customer control; it does not establish estimation accuracy.

Estimate in this order: explicit customer estimate for the same scope; comparable personal completed-task history; project-specific estimate; applicable external reference; model estimate with assumptions. An external benchmark is weak evidence for a particular customer's pace.

Ask for concrete scope when it changes the estimate substantially: revise a two-page draft or write twenty pages from scratch? Distinguish total remaining effort from the next session. A 60-minute session for a three-hour task must not be presented as task completion.

Collect actual active effort through optional Start/Pause/Finish sessions or a customer-entered total. Store scope, task category, estimate-at-start, actual minutes, interruptions, completion, and provenance within the existing profile boundary. Calendar block length and foreground app use are not ground truth. Do not learn blindly from cancelled, interrupted, or incomplete sessions.

Initially use robust summaries of genuinely comparable completed work and show the sample count. Mix small samples conservatively with the baseline; do not present a chosen sample threshold or range as statistically proven. Later compare personal calibration against the existing heuristic/model baseline on held-out or chronological examples.

Keep low/expected/high estimates, basis, assumptions and confidence visible. These are uncertainty ranges, not promised completion probabilities. Customer-confirmed minutes are a chosen planning value, not a guarantee of actual duration. Keep the original estimate separately for evaluation.

Recommended task card:

- A labeled native duration slider in 15-minute steps for common sessions, paired with an exact numeric input and keyboard operation.
- Scope selector: One work session / All remaining work.
- Original estimate and basis, e.g. “AI estimate: 45–90 min · Low confidence.”
- A separate selected planning duration, live proposed start/end and capacity feedback.
- Save and replan drafts through a bounded deterministic operation. No AI rerun is needed just to change minutes. Saving facts invalidates the old preview; Apply remains a separate reviewed action.

Do not alter the original AI range to suggest a customer adjustment increased model confidence. If the duration no longer fits, move the draft to another permitted slot or show it as unscheduled. Do not shorten it, invade lunch, or silently move already-applied events.

The current scheduler requires an unsplit session. First ship that behavior clearly. Later allow explicit splittable work with minimum/maximum session lengths, per-session buffers, and dependencies that complete only when all required effort is allocated. If capacity before a hard deadline is insufficient, show the shortfall and let the customer change scope, hours, or deadline.

## 6. Delivery order and meaningful verification

1. Weekly working calendar plus visible plan hours and duration slider. Validate break boundaries, weekends, empty availability, exceptions, legacy migration, timezone/DST, stale Apply, numeric/slider synchronization, capacity conflicts and unchanged applied events.
2. Source-backed deadline candidates from selected text/files, including the compact-provider path. Validate task matching, quoted evidence, explicit versus relative/date-only dates, conflicts, unsupported deadlines and source revisions.
3. One read-only mail connector, evaluated with synthetic mailbox fixtures before any consented live test. Test authorization failure, limits/pagination, cancellation, profile isolation and revoked/stale sources.
4. Optional actual-effort feedback and personal calibration. Report absolute error in minutes, systematic over/underestimation and range coverage by task category and sample count. Compare against the present baseline; exclude calendar length as an actual-effort label.
5. Only then add desktop window reading and optional multi-session/multi-day allocation if customer needs justify them.

Scheduling acceptance requires zero overlap with forbidden hours and busy intervals, zero hard-deadline violations, and an explanation for unallocated work. Deadline evaluation should measure both missed explicit dates and unsupported suggestions; an honest unknown is preferable to an invented date. Source evidence and actual-duration payloads must stay out of generic telemetry, commits and documentation.

## Primary references

- Gmail scopes and restricted-scope requirements: https://developers.google.com/workspace/gmail/api/auth/scopes
- Microsoft Graph message listing: https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0
- Microsoft Graph Mail.Read / Mail.ReadBasic: https://learn.microsoft.com/en-us/graph/permissions-reference#mailread
- Windows UI Automation: https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32

The companion preview uses invented task content, one permitted day's hours, and a simulated earliest start of 11:45. It demonstrates hours and duration interactions only; it does not implement connectors, persistence, the production allocator or task facts.
