# Agent summarization and planning project

## User requirements
- The user is learning complete practical agent engineering. Explain the lifecycle first, then explain code, responsibilities, tests, and limitations after each implementation stage.
- Local destination (confirmed 2026-10-02): D:\project\Agent_summarize_planning.
- GitHub: https://github.com/kyee179/Agent_summarize_planning.
- Existing app: https://github.com/kyee179/Calendar_App, React/Vite, Express, Electron.
- Git commit messages: feat/fix/docs/test/chore: description.
- Cover roles, goals, instructions, tools, output schemas, open source components, layered/versioned prompts, evaluation, deployment, monitoring.

## Product purpose
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
