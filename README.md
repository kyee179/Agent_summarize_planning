# Agent Summarization and Planning Calendar

This repository develops the personal planning agent from the existing [Calendar App](https://github.com/kyee179/Calendar_App) (MIT, starting commit `335b8f0`). Read [PROJECT_BRIEF.md](PROJECT_BRIEF.md) for the agreed product requirements and [docs/STEP_01.md](docs/STEP_01.md) for the complete first-stage code walkthrough, verification, and remaining engineering work.

Stage 1 adds authenticated local API access, a trusted Electron IPC bridge, explicit environment loading, SQLite with one-time JSON migration, online backup, and atomic/idempotent draft application. The current implementation also includes versioned contracts, deterministic scheduling, versioned skills, bounded tool calling, authorized ActivityWatch ingestion, Google Calendar read-only OAuth, local hybrid personal retrieval, and cited web research. Read [docs/STEP_05.md](docs/STEP_05.md) for setup, the code walkthrough, verification, and remaining quality evaluation work.

Study Calendar is A learning-focused desktop calendar built with React, Node.js, and Electron. It displays the current date and time, shows a month calendar and agenda, stores reminders locally, saves daily/weekly journals, bookmarks precious entries, and lets users create, edit, delete, and preview notifications in this format:

```text
time: a to b; title; notification format
```

The project is intentionally small enough to understand while still using a realistic software-development pipeline: API contracts, validation, linting, automated tests, GitHub Actions, and Electron release packaging.

## Features

- Month and agenda views
- Current date, current time, and local timezone display
- Reminder CRUD: create, edit, delete, and list reminders
- Reminder fields: start/end time, title, notification format, notes, category, repeat, location, color, and notify-before time
- Basic calendar categories: personal, study, vacation, holiday, birthday, and other
- Daily and weekly journals
- Bookmark button for precious journals
- AI planning drafts with GLM (default glm-4-flash), OpenAI/Gemini/Groq adapters and local fallback rules
- Optional ActivityWatch import with AFK filtering, redaction and scoped consent
- Google Calendar browser OAuth and selected read-only busy intervals
- SQLite keyword memory with optional local Ollama embeddings and hybrid ranking
- Authorized Brave Search research with visible sources and low-confidence snippets
- Weekly summary generation from journal context
- User-reviewed `Apply Drafts` flow before AI suggestions become calendar events- Desktop notifications when the app is open and notification permission is granted
- Local SQLite storage through an authenticated Node.js API
- Electron shell for a desktop app
- GitHub Actions CI and release workflow

## Tech Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Desktop: Electron
- Tests: Vitest
- Linting: ESLint
- Packaging: electron-builder

## Local Development

Prerequisites:

- Git
- `fnm` for Node.js version management
- Node.js 24.18.0 LTS, installed through `fnm`
- pnpm 11.7.0, activated through Corepack
- Optional for publishing: GitHub CLI (`gh`)

This repository includes `.node-version`, `packageManager`, and `engines` settings so each developer uses the same runtime.

First-time Windows setup:

```powershell
fnm install 24.18.0
fnm use 24.18.0
corepack enable
corepack prepare pnpm@11.7.0 --activate
```

Verify the environment:

```powershell
node --version
pnpm --version
```

Expected major versions are Node `v24.x` and pnpm `11.x`.

Install dependencies:

```bash
pnpm install
pnpm setup:env
```

Optional AI provider setup:

```bash
pnpm setup:env
# default AI_PROVIDER=glm with GLM_MODEL=glm-4-flash
# set GLM_API_KEY locally; choose local, openai, gemini, or groq if desired
# add the matching API key if using a remote provider
```

The app always keeps a local rule-based fallback, so journal planning still works when an API key is missing or a quota is exhausted.
Run the API, React app, and Electron together:

```bash
pnpm dev
```

Run only the backend:

```bash
pnpm start:api
```

Run validation:

```bash
pnpm lint
pnpm test
pnpm build
pnpm smoke:desktop
```

Build desktop installers:

```bash
pnpm build:desktop
```

The packaged desktop app is written to `release/`.

## API Contract

See [docs/API.md](docs/API.md).

## Data Schema

See [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md).

## Project Structure

```text
.
|-- electron/              # Electron main process and preload script
|-- server/                # Express API, SQLite, and planning contracts
|-- src/                   # React frontend
|-- docs/                  # API and data documentation
|-- .github/               # CI, release workflow, issue templates
|-- package.json
`-- README.md
```

## Roadmap

- Add recurring-event expansion in the UI
- Add drag-and-drop event movement
- Add import/export for `.ics` calendar files
- Add multi-day/task-splitting policy (deterministic scheduling around existing events and availability is implemented)
- Add AI planning features after the core calendar is stable

## License

MIT

## Learning walkthroughs

- [Step 1: local API security and SQLite](docs/STEP_01.md)
- [Step 2: task, evidence, estimate, and planning contracts](docs/STEP_02.md)

Run `pnpm schemas:export` after editing the runtime schema definitions. Schema export parity is checked by the test suite. The review panel shows source excerpts, uncertain effort ranges, and unknown deadlines. New analyses use a validated canonical contract; calendar writes still require Apply Drafts.

- [Step 3: deterministic scheduling around calendar events](docs/STEP_03.md)

Plans now reserve existing events and recurring commitments, preserve buffers, and report work that does not fit. Apply rechecks reviewed inputs inside the database transaction and asks for reanalysis when the calendar/settings changed. Task estimates remain uncertain; scheduled work sessions do not prove completion.
## Versioned skills and bounded analysis

Remote journal analysis now uses pinned `daily-summary` and `task-planning` skills
with four controlled tools, validated previews, resource limits, and explicit local
fallbacks. Summaries include reviewable source references. Calendar writes continue
through the reviewed, atomic Apply action. See [Step 4 walkthrough](docs/STEP_04.md)
for architecture, code, limits, version updates, and verification scope.

The default provider is now GLM with model `glm-4-flash`. Configure `GLM_API_KEY`
only in the ignored local `.env`; see [GLM configuration](docs/GLM_CONFIGURATION.md)
for effective settings, the vendor adapter, bounded continuation, and live-test scope.

## Integrations and operational quality

- [Step 5: authorized activity, Google Calendar, hybrid memory and cited research](docs/STEP_05.md)
- [Step 6: evaluation, CI, tracing, monitoring and rollback](docs/STEP_06.md)
- [Evaluation dataset, metrics and human-review rubric](evaluation/README.md)

```powershell
pnpm eval            # Offline synthetic regression gates; no provider/account access
pnpm eval:live       # Explicitly sends three synthetic examples to the configured AI
pnpm release:check   # Policy, lint, tests, offline evaluation and build
pnpm smoke:desktop   # Electron smoke using temporary synthetic data
pnpm monitor         # One-shot authenticated standalone-API health probe
pnpm backup:db "D:\backups\new-snapshot.sqlite"
pnpm restore:db "D:\backups\new-snapshot.sqlite" "D:\backups\new-recovery.sqlite" 2
```

Journals → **System health → Check health** shows local operational diagnostics.
Traces exclude personal source content and credentials, rotate locally, and are
ignored by Git. Recovery verifies a backup into a new database path; stop the app
before switching `CALENDAR_DB_PATH`. Read the walkthrough for schema/code/prompt
compatibility and private encryption-key handling.

On 2026-10-12 all offline gates passed, while challenge task precision/recall were
50%/66.7%. Live `glm-4-flash` evaluation failed: all three runs timed out and used
validated fallback. Regression correctness does not establish improved model
quality, calibrated effort estimates, or readiness to replace an installed
Calendar_App. CI does not use personal/provider credentials or publish installers.

## GLM and optional connections update (2026-10-15)

[Fix guide](docs/FIX.md) documents the GLM protocol fix and simpler connection
controls. The final three-case `glm-4-flash` live run passed with no fallback
(9.7–14.5 seconds per case; metric version 2). The Journals connection cards now
offer Google sign-in with automatic primary-calendar sync, opt-in built-in Windows
app activity without a separate ActivityWatch download, and Tavily web research.
Google OAuth app configuration and a Tavily API key are required for those live
account tests. Keys remain in ignored local configuration; activity collection
and permission to include it in AI analysis are separate controls.
