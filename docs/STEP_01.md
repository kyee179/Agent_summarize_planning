# Step 1: reliable local foundations

## Why this step comes before RAG and agents

The planner will eventually consume untrusted journals, webpages, and tool results. Before improving its reasoning, we need a trustworthy boundary for reading private data and applying approved changes. This stage changes transport and persistence; the analysis prompt remains the existing baseline.

## 1. Request flow and local API security

Desktop flow:

```text
React api.js -> preload request() -> calendar:request IPC
  -> trusted main frame + route validation
  -> Electron main fetch with a private random bearer token
  -> loopback Express API -> SQLite
```

`server/security.cjs` checks the actual Host header against loopback names and the listening port. It rejects foreign/null origins and cross-site requests. Every `/api/*` endpoint requires a bearer token compared using a timing-safe comparison. `/health` exposes only a readiness flag. The server binds to `127.0.0.1`, disables Express branding, and marks responses non-cacheable.

Binding to loopback alone is insufficient: webpages can attempt localhost requests. The token authenticates API clients; origin/fetch-site checks block hostile browser requests; Host checking protects against DNS rebinding.

`electron/apiBridge.cjs` restricts routes and methods. `trustedSender()` verifies the sending webContents and main frame, then verifies the development origin or exact packaged page URL. `preload.cjs` exposes one request method, without raw IPC, tokens, or provider keys. The main process starts the API on an automatically assigned port with a new 32-byte random token on each launch. Navigation is blocked and external links are restricted to HTTP(S). Context isolation, renderer sandboxing, and disabled Node integration remain explicit.

Browser development flow:

```text
Browser -> same-origin Vite /api proxy
  -> Host/origin/fetch-site checks in Vite
  -> server-side bearer header injection
  -> loopback Express API -> SQLite
```

Vite requires the exact `http://127.0.0.1:5173` host/origin. It strips Origin only after checking the incoming request and injects the private token server-side. `src/api.js` uses relative URLs in the browser and IPC in Electron. There are no `VITE_*` credential variables and no bearer token in the browser bundle. Direct cross-origin browser access to port 4010 is intentionally unsupported.

This protects against unauthorized browser clients; a malicious process already running as the same OS user remains outside this protection boundary. SQLite content is not encrypted in this stage.

## 2. Explicit environment loading

`server/environment.cjs` uses Node's built-in `process.loadEnvFile()` with an explicit file path. Existing process variables take precedence over `.env`. A missing optional file is allowed; malformed existing configuration fails visibly.

- Standalone API and Vite: project root `.env`.
- Development Electron: project root `.env`.
- Packaged Electron: `.env` in Electron's `userData` directory; project credentials are never bundled.
- `pnpm setup:env`: creates `.env` from `.env.example` if missing and fills a missing/invalid local token without printing credentials.
- `pnpm dev`: loads configuration and supplies a shared random token to the API/Vite child processes if no token is configured. Electron uses its own independent process token.

Runtime requires Node 24.18.0 or later. This stage uses built-in SQLite and environment loading, so there is no native SQLite dependency to rebuild for Electron.

## 3. SQLite storage and migration

`server/store.cjs` retains the existing store methods, allowing the API to keep its public CRUD behavior. It uses bound SQL parameters and separate tables:

| Table | Purpose |
| --- | --- |
| settings | One settings JSON document |
| events | ID, numeric start/end timestamps, and full event JSON |
| journals | ID and complete journal JSON |
| analyses | Latest analysis per journal, with a unique analysis ID |
| applied_batches | Persistent receipt for each applied analysis |
| metadata | Initial import provenance |

JSON columns retain existing API fields while timestamps are indexed for range queries. This is a transitional schema; typed tasks, evidence, and activity tables come in later stages.

Foreign keys remove the saved analysis when its journal is deleted. Journal deletion removes associated application receipts; already created calendar events remain independent. Editing journal content/date/type invalidates the old analysis. The batch receipt survives reanalysis or edits, so a retry for an already committed batch still returns the original result.

The store enables WAL, a five-second busy timeout, and FULL synchronous durability. Writes that span records use `BEGIN IMMEDIATE`, `COMMIT`, and `ROLLBACK`. WAL permits readers alongside a writer, while SQLite serializes writers. This synchronous store is suitable for a small local app; larger workloads should use a worker or asynchronous database layer.

`PRAGMA user_version` tracks schema version 1. On first initialization, the schema, default/imported records, metadata, and version update occur in one transaction. If a sibling `calendar.json` exists, it is imported once. The JSON remains untouched as a recovery source. A corrupt JSON file or database error aborts startup rather than silently replacing user data. A newer database version is rejected instead of downgraded.

Default development database: `server/data/calendar.sqlite`. Packaged database: `calendar.sqlite` inside Electron's `userData`. `CALENDAR_DB_PATH` overrides the standalone API path. Both databases and environment files are ignored by Git, and `server/data/**` is explicitly excluded from desktop packaging.

`pnpm backup:db <new-file>` uses SQLite's online backup API, so it can back up a live WAL database consistently. The command refuses to overwrite an existing destination. To restore, close all app/API processes, preserve the current database and its WAL/SHM files, then point `CALENDAR_DB_PATH` at the backup or restore it at the expected location. Do not copy only the live main database file while the app runs.

## 4. Atomic, idempotent Apply Drafts

Previously the renderer sent one `POST /api/events` per draft. A failure could leave some events created, and retries could duplicate them.

The renderer now sends one request:

```http
POST /api/journals/{journalId}/apply-drafts
Content-Type: application/json

{"analysisId":"the-analysis-the-user-reviewed"}
```

The server retrieves the stored analysis rather than accepting replacement draft content from the renderer. Inside one transaction it:

1. Looks for a receipt with that analysis ID. If found for the same journal, return the original result with `replayed: true`.
2. Checks that the requested analysis is the journal's current analysis.
3. Validates all drafts (1–100): required fields, finite ISO timestamps with timezone, positive duration, known calendar category, string fields, and valid reminder minutes.
4. Creates every event and the receipt.
5. Commits once, or rolls everything back on failure.

First successful application returns 201. A retry returns 200 and the original event IDs. Invalid drafts return 400. Stale analysis returns 409. No partial calendar changes are committed. Database constraints also roll back mid-insert failures. `analysisId` serves as the idempotency key; applying a genuinely new analysis is a new user action and can create additional events.

The UI disables Apply while pending and after success; reloading the analysis restores its applied status. The server remains the protection against concurrent clicks, interrupted requests, or restarts. Analysis saves current editor text first, and results are rejected if the source journal changes during the provider call.

This stage validates persistence inputs. Calendar overlap detection, recurring-event expansion, planning deadlines, and duration estimation belong to the scheduler stage and are not yet guarantees.

## 5. Tests and how to run

```powershell
cd D:\project\Agent_summarize_planning
pnpm install --frozen-lockfile
pnpm setup:env
pnpm dev
```

Use `http://127.0.0.1:5173` for the browser version. API provider credentials remain optional; `AI_PROVIDER=local` requires no paid service. Run the standalone backend with `pnpm start:api` after setup. For API scripts, load `LOCAL_API_TOKEN` from local configuration and supply Authorization; never paste it into screenshots or commit it.

```powershell
pnpm lint
pnpm test
pnpm build
pnpm smoke:desktop
pnpm smoke:web
pnpm backup:db D:\backups\calendar-2026-10-02.sqlite
```

Server tests exercise real loopback HTTP requests, denied authorization/origins/hosts, concurrent retries, rejected drafts with zero writes, merged event-update validation, immutable IDs, source invalidation, migration/restart, corrupt import recovery, mid-insert rollback, backup restore, and environment precedence. Frontend tests verify IPC/same-origin transport and one batch request. Desktop smoke tests run the Electron main/preload/renderer path against an isolated temporary database.

## Remaining engineering work

- Goal/evidence/task schemas, conflict-aware scheduling, timezone and recurrence rules.
- Provider timeout, retry, usage/cost budgets and strict model-output schemas.
- Credential vault and local data encryption decisions when OAuth/activity ingestion is added.
- Prompt/skill versions and quality evaluations beyond transport/storage tests.
- Signed installers and update policy before distributing production releases.

## Attribution

This project starts from https://github.com/kyee179/Calendar_App at commit `335b8f022505c1033e0e8f0804b626c9d22a9c29`, retaining its MIT license. The existing Calendar app installation and personal data are not modified by development here.

## Verification recorded on 2026-10-02

- ESLint passed with no warnings.
- 8 frontend/analyzer tests and 12 server tests passed (20 total).
- Production Vite build passed.
- Hidden Electron smoke passed against temporary storage, exercising the real main/preload/renderer path and rendered UI.
- Browser smoke passed against temporary storage through the actual Vite proxy.
- Four-process SQLite initialization and four-process application retry test passed.
- SQLite backup restored correctly in tests.

Electron's GPU subprocess could not run inside this session's sandbox; the hidden test passed outside it. A signed installer release was not built in this stage.
