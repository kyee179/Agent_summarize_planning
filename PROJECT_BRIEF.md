# Agent summarization and planning project

## User requirements
- The user is learning complete practical agent engineering. Explain the lifecycle first, then explain code, responsibilities, tests, and limitations after each implementation stage.
- Local destination (confirmed 2026-10-02): D:\project\Agent_summarize_planning.
- GitHub: https://github.com/kyee179/Agent_summarize_planning.
- Existing app: https://github.com/kyee179/Calendar_App, React/Vite, Express, Electron.
- Git commit messages: feat/fix/docs/test/chore: description.
- Cover roles, goals, instructions, tools, output schemas, open source components, layered/versioned prompts, evaluation, deployment, monitoring.

## Product purpose
The user clarified on 2026-10-11 that this is Calendar App 2.0: an iteration of the existing Calendar_App, preserving its calendar, journal, and reminder functionality while improving summary and planning. The separate Agent_summarize_planning repository is the current development location, not a separate product. Plan explicit migration and upgrade compatibility before distributing it as a replacement; the current separate Electron app identity does not yet upgrade the original installation automatically.
Improve daily/weekly summaries and realistic task planning using journals, calendar commitments, user goals, selected documents/links, and optionally authorized computer/browser activity.
Preserve human review before calendar writes. Track sources and uncertainty; never invent deadlines or completion from browsing activity.

## Architecture decisions
Workflow owns permissions, validation, retries, budgets, deterministic scheduling, and writes.
Agent owns task interpretation, decomposition, bounded research/tool selection, and explanations.
Structured database stores tasks, events, activity, and outcomes. RAG retrieves relevant journals, documents, goals, and historical task estimates. Add semantic search when retrieval evaluations justify it.
Duration evidence: personal history, project estimates, authoritative research, then uncertain model estimates.
Deadline evidence: explicit task/documents/calendar/official page; otherwise unknown or ask user.
Importance comes from user goals, consequences, dependencies, and commitments.

## Roadmap
1. Local API security, environment loading, atomic/idempotent batch apply, SQLite and JSON migration.
2. Evidence/task/planning schemas and deterministic conflict-aware scheduling.
3. Versioned summary/planning skills and layered prompts; bounded agent tool loop.
4. Optional ActivityWatch/browser ingestion and Calendar OAuth with scoped consent.
5. Personal retrieval and cited web research.
6. Quality/security evaluation, CI gates, tracing, deployment, monitoring, rollback.

## Session state
2026-10-02: stage 1 implemented: token/Host/origin protection, trusted Electron IPC, server-side Vite proxy, explicit .env loading, SQLite schema v1 + preserved one-time JSON migration, atomic/idempotent apply, source invalidation, backup tooling. Tests: 8 frontend/analyzer + 12 server tests, production build, hidden Electron and browser proxy smoke tests. Code walkthrough: docs/STEP_01.md. Planning remote was empty; seeded from Calendar_App commit 335b8f022505c1033e0e8f0804b626c9d22a9c29 with MIT license and attribution. Next: typed task/evidence schemas and deterministic conflict-aware scheduler. Do not modify the existing D:\project\Calendar app or personal data.

2026-10-11: stage 2 schema foundation implemented: versioned closed JSON Schemas for task/evidence/estimate/plan/bundle, Ajv and semantic validation, immutable workflow-collected evidence, range/scope/uncertainty semantics, provider validation/fallback, canonical analysis persistence with compatibility projections, source checks under batch transactions, and review UI. SQLite remains v1; contract schema is independently v1. Legacy records keep stage-1 behavior. No web/activity ingestion or automatic fact extraction yet. Local estimates are tentative next-session effort, deadlines remain unknown. Verification: 40 tests (10 frontend/analyzer and 30 server), lint, production build, and real Electron smoke passed using synthetic data. Walkthrough: docs/STEP_02.md. Next: deterministic scheduling against actual calendar commitments, calendar snapshot/apply revalidation, recurrence, durable task identities, and confirmed fact ingestion. This stage is the schema portion of roadmap step 2; conflict-aware scheduling remains pending.

2026-10-11: deterministic scheduler implemented, completing roadmap step 2's scheduling portion. Workflow allocation uses merged availability minus existing/recurring events and buffers, ready-task ordering by deadline/importance/ID, full unsplit expected sessions, and explicit unscheduled reasons. Both local and remote interpretation use the same pure scheduler. New API plans capture notBefore and default to today for historical journals (optional targetDate override). Scheduling metadata v1 records occupancy/settings fingerprints; persistence and Apply recheck relevant inputs under a writer transaction, reject stale/elapsed allocations with 409, and preserve receipt replay. Repeat presets use local-clock anchors with recurrenceTimezone on new/updated series; invalid monthly/leap dates and nonexistent clocks are skipped, ambiguous future clocks conservatively reserve both offsets. Legacy plans receive live conflicts checks. Contract/SQLite remain v1. Verification: 68 tests (10 frontend/analyzer + 58 server), lint, production build, and real Electron recurrence/stale-calendar/apply/replay smoke passed. Walkthrough: docs/STEP_03.md. Next: versioned summary/planning skills and layered prompts, bounded agent tools, confirmed fact ingestion, durable task identity, retrieval and evaluation. Scheduling is single-day greedy allocation; recurrence UI/reminder expansion and optional multi-day/splitting remain future work. No personal database was modified.
