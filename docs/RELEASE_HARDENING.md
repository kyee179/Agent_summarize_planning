# Release hardening: eight findings

Implemented 16 October 2026 against the frontend-redesign checkout. This work addresses the eight rows in **The most important findings** from the release review. It does not add application login, cloud synchronization, or distribute an installer.

## 1. Keep each operation attached to its journal

`src/app/useWorkspace.js` now tracks operation activity separately from result freshness. Settings/calendar changes can make a result stale while the original operation remains busy. Journal switching is guarded inside the hook as well as in the UI. Generation captures journal and context revisions and discards responses for changed context or the wrong journal. Apply independently checks the current journal ID. `PlanWorkspace` hides a mismatched result and refreshes its comparison when the shared event data changes.

This keeps the lifecycle explicit: save → generate → review → apply. An invalidated result cannot become actionable merely because a network response arrived later. Note fields are also disabled during Save to protect edits.

## 2. Give generation and review their own time

The API uses a default five-minute planning lead time, then recalculates the final deterministic schedule from a fresh clock after interpretation finishes. Settings exposes **Time to review before a plan starts**, bounded to 1–120 minutes. The relevant-settings fingerprint includes this value. Apply still rejects elapsed or changed allocations; it never silently moves an already reviewed block.

## 3. Preserve source text and show coverage

`server/contracts/journalEvidence.cjs` splits oversized sentences into bounded exact source chunks. Each returned analysis has `evidenceCoverage`, including source IDs, UTF-16 start/end offsets, included and omitted character counts. `content.slice(start,end)` reproduces an excerpt. Whitespace and sentence delimiters are excluded from these text counts. The canonical planning contract remains v1.

The bounded evidence budget is retained: normal analysis reserves eight slots for task confirmations and uses up to 92 initial/retrieved records in the existing 100-record contract. Larger inputs receive a partial-coverage warning, rather than disappearing silently. Tool pagination stops below 60 KB of UTF-8 JSON and returns the next unread offset. Long requests can still exhaust the unchanged model turn/time budget and use the validated local fallback.

## 4. Make Chinese fallback and lexical retrieval useful

The local baseline recognizes explicit Chinese/mixed-language future-action signals and rejects common Chinese negation/cancellation/completion, as well as ordinary English past statements. It conservatively abstains where its rules do not recognize intent. It is still a rules baseline, not a general Chinese language model.

`server/integrations/searchText.cjs` uses `Intl.Segmenter`, normalization and CJK tokens/bigrams consistently for indexing and queries. Original text remains in the chunk for citations. Multi-character queries avoid single-Han-character OR matches. The v3 migration rebuilds the derived FTS index so old notes also benefit. Two-character queries are covered explicitly; [SQLite documents the tokenizer and trigram limitations](https://www.sqlite.org/fts5.html).

Dataset 1.1.0 adds six Chinese/mixed-language gating cases and two Chinese retrieval queries, without lowering thresholds or changing the eight challenge labels. Long-input and byte-budget regressions run in the required server suite. This is regression coverage; independently reviewed multilingual holdout and real IME acceptance are still release work.

## 5. Give tasks durable identity and session links

SQLite schema 3 adds `durable_tasks`, `task_analyses`, `task_sessions` and `reminder_receipts`. Existing schema 1/2 databases get a verified pre-migration snapshot. Recovery tooling and the release compatibility manifest accept v3 and reject newer schemas. Do not open a migrated v3 database with older application code; restore its preserved pre-migration snapshot to a new path for rollback.

New analyses resolve stable task IDs from title/source evidence within the journal. Unique evidence matches can survive model rewording; ambiguous prior matches are blocked for review. Exact duplicate candidates are consolidated. Persisted revisions and linked sessions are checked under the writer transaction at Apply, alongside source/calendar freshness. A task with an existing session is blocked from automatic re-planning. The user can complete/cancel it, delete the event, or explicitly request another session. Completion is never inferred from elapsed calendar time or app activity.

Migration adopts old events that can be traced through an application receipt, preserving their times and replay receipts. Historical work without a recoverable receipt/task association cannot be reliably deduplicated automatically. Task matching is conservative; arbitrary paraphrases or mentions in a different journal are not guaranteed to resolve to the same task. Cross-journal semantic identity/merge review remains a future extension.

The task tables have an explicit local profile owner. The present database remains one local profile; application login and account switching require a separate isolation/session implementation.

## 6. Confirm facts before scheduling with them

The Plan inspector offers **Confirm or edit facts** for deadline, duration/scope, importance, dependencies, title and status. Deadline entry resolves in the plan timezone and rejects invalid/ambiguous local clocks. Simple source date/duration candidates are suggestions only; relative dates use the source journal date. Unspecified times remain unspecified until the user chooses one.

`server/tasks.cjs` validates edits, optimistic revisions and dependency cycles. Confirmed facts become separate `user_confirmed` evidence with a task revision. Scheduling receives the confirmed deadline and effort only after the edit is saved and a fresh plan is generated. Missing confirmed dependencies leave a task blocked. Editing facts keeps existing calendar times. **Tracked tasks** keeps completion/reopen controls available even when a later analysis omits a task.

## 7. Persist reminders and catch up

`electron/reminders.cjs` runs checks in Electron main every 15 seconds and on resume. It expands the same recurrence rules as the calendar, claims each occurrence/reminder once in SQLite and retries reported delivery failures. Catch-up is bounded to the preceding 24 hours; receipts expire after 30 days. The browser path uses the same receipt API and refreshes after focus/visibility changes; desktop rendering does not also deliver a second notification.

A running application and OS notification support/permission are still required. Native notification delivery is subject to OS behavior; claiming a receipt and OS display are not one atomic transaction. A crash between them can lose a notification. Mock-clock delivery tests and a real hidden Electron process were exercised; a visible OS suspend/resume notification test was not performed.

## 8. Provide secure desktop setup

Settings includes **Set up your services**. Users can choose local rules or provide their own AI key/model, a Tavily key and a Google Desktop OAuth JSON download. Google sign-in remains a separate explicit Connections action after restart. Empty password fields preserve saved credentials. Credentials are never returned to the renderer after saving, written to journals, or put in `.env` by this UI.

`electron/credentials.cjs` validates an allowlist and Google endpoints, atomically writes OS-encrypted `credentials.encrypted` under userData and generates/preserves the Google token-encryption key. Trusted main-frame IPC owns setup and restart. Saved settings take effect after the user clicks **Restart app**, avoiding half-reconfigured in-flight integrations. Linux `basic_text` fallback is refused. Files are ignored and rejected by the tracked-private-file gate. [Electron describes the platform-specific safeStorage protections](https://www.electronjs.org/docs/latest/api/safe-storage); this does not encrypt the journal database or defend against every app under the same OS user.

Local rules work without external credentials. This implements user-owned credentials, not an app-funded service, identity provider, quotas or production Google verification. Unavailable/unlock-failed OS storage is reported without overwriting the encrypted file.

## Validation

Use `pnpm release:check`, `pnpm smoke:desktop` and `pnpm smoke:web`. New regressions live in `tests/release-hardening.test.cjs` and `src/releaseHardening.test.jsx`; the desktop smoke also checks the real secure-setup bridge and persistent session linkage. All test databases and setup values are synthetic. No paid-provider request or real account operation is required by these checks.

The current run's final counts and limitations are recorded in PROJECT_BRIEF.md. Public installer/signing/clean-machine verification, live multilingual provider evaluation, real OS notification delivery and production account readiness remain release gates.
