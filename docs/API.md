# API Contract

Base URL in development: `http://127.0.0.1:4010`

Every `/api/*` request requires `Authorization: Bearer <LOCAL_API_TOKEN>`; only `/health` is public. The API binds to loopback and rejects untrusted hosts, browser origins, and cross-site requests. Browser development uses the same-origin Vite proxy at `http://127.0.0.1:5173`; Electron uses the preload IPC bridge and a private per-process token. No direct browser CORS access is enabled. Run `pnpm setup:env` to generate local configuration. Do not expose tokens through `VITE_*` variables.

All request and response bodies are JSON unless otherwise noted.

## Health

### `GET /health`

Response `200`:

```json
{
  "ok": true,
  "service": "study-calendar-api"
}
```

## Time

### `GET /api/time`

Returns server-local time information.

Response `200`:

```json
{
  "now": "2026-07-08T19:30:00.000Z",
  "localTime": "8:30:00 PM",
  "localDate": "7/8/2026",
  "timezone": "Europe/London"
}
```

## Settings

### `GET /api/settings`

Response `200`:

```json
{
  "timezone": "Europe/London",
  "locale": "en-US",
  "weekStartsOn": 0,
  "defaultNotifyMinutesBefore": 15
}
```

### `PUT /api/settings`

Request body may include:

```json
{
  "timezone": "Europe/London",
  "locale": "en-US",
  "weekStartsOn": 1,
  "defaultNotifyMinutesBefore": 10
}
```

Response `200`: updated settings object.

## Events / Reminders

### Event Object

```json
{
  "id": "uuid",
  "title": "Read React docs",
  "startsAt": "2026-07-08T09:00:00.000Z",
  "endsAt": "2026-07-08T10:00:00.000Z",
  "calendarType": "study",
  "location": "Library",
  "notes": "Focus on hooks and state.",
  "color": "#16a34a",
  "notifyMinutesBefore": 15,
  "notificationFormat": "Desktop notification",
  "repeat": "none",
  "createdAt": "2026-07-08T08:00:00.000Z",
  "updatedAt": "2026-07-08T08:00:00.000Z"
}
```

Allowed `calendarType` values:

- `personal`
- `study`
- `vacation`
- `holiday`
- `birthday`
- `other`

Allowed `repeat` values:

- `none`
- `daily`
- `weekly`
- `monthly`
- `yearly`

### `GET /api/events?from={iso}&to={iso}`

Returns events overlapping the requested date range.

Response `200`:

```json
[
  {
    "id": "uuid",
    "title": "Read React docs",
    "startsAt": "2026-07-08T09:00:00.000Z",
    "endsAt": "2026-07-08T10:00:00.000Z",
    "calendarType": "study",
    "notificationFormat": "Desktop notification"
  }
]
```

### `POST /api/events`

Request body:

```json
{
  "title": "Read React docs",
  "startsAt": "2026-07-08T09:00:00.000Z",
  "endsAt": "2026-07-08T10:00:00.000Z",
  "calendarType": "study",
  "location": "Library",
  "notes": "Focus on hooks and state.",
  "color": "#16a34a",
  "notifyMinutesBefore": 15,
  "notificationFormat": "Desktop notification",
  "repeat": "none"
}
```

Response `201`: created event object.

Validation error `400`:

```json
{
  "errors": ["title is required"]
}
```

### `PUT /api/events/{id}`

Request body: any editable event fields.

Response `200`: updated event object.

Response `404`:

```json
{
  "error": "Event not found"
}
```

### `DELETE /api/events/{id}`

Response `204`: no body.

## Journals

### Journal Object

```json
{
  "id": "uuid",
  "type": "daily",
  "journalDate": "2026-07-13",
  "title": "Journal 2026-07-13",
  "content": "I finished one assessment and should work on the dissertation experiment.",
  "bookmarked": true,
  "tags": [],
  "createdAt": "2026-07-13T12:00:00.000Z",
  "updatedAt": "2026-07-13T12:00:00.000Z"
}
```

Allowed `type` values are `daily` and `weekly`.

### `GET /api/journals?type=daily&bookmarked=true`

Returns journals sorted by most recently updated.

### `POST /api/journals`

Creates a journal. Required fields: `type`, `journalDate`, `title`, and `content`.

### `PUT /api/journals/{id}`

Updates editable journal fields, including `bookmarked`.

### `DELETE /api/journals/{id}`

Deletes a journal and its saved analysis.

### `POST /api/journals/{id}/analyze`

Analyzes a journal with the configured AI provider. If the provider is missing an API key or fails, the server falls back to the local rule-based analyzer.

Request body may include availability windows:

```json
{
  "availability": [
    { "label": "Evening", "startsAt": "20:00", "endsAt": "24:00" }
  ]
}
```

Response `201` includes `id`, `journalId`, `createdAt`, `provider`, `model`, `summary`, `weeklySummary`, `cautions`, and a canonical `contract`:

- `contract.schemaVersion`: 1.
- `contract.evidence`: workflow-collected source excerpts, versions, verification, and normalized facts.
- `contract.tasks`: evidence-linked task state, importance, optional deadlines, estimate references, dependencies, and clarification questions.
- `contract.estimates`: scope, basis, effort ranges or null, confidence, evidence, and assumptions.
- `contract.plan`: proposal state, timezone/date/availability/buffer, proposed blocks, and unscheduled reasons.

The root `tasks` and `scheduleDrafts` arrays are derived compatibility views. Their values are checked against the canonical contract before persistence. Root task `urgency` is currently `unknown`; `estimatedMinutes` can be null. See [the complete synthetic response](examples/analysis-v1.json), [versioned JSON schemas](schemas/v1/bundle.json), and [STEP_02.md](STEP_02.md).

Malformed planning inputs return `422` with `error` and `issues: [{path, code, message}]`. Invalid provider output falls back to validated local analysis with a caution. Invalid timezone or default availability settings are also rejected with `422`. Empty availability is valid and produces unscheduled work. Overnight windows must be split; ambiguous/nonexistent timezone clocks fail explicitly.

GET analysis adds `contractStatus: versioned|legacy` and the existing `applied` flag. Legacy saved records remain readable and retain their stage-1 apply behavior; they do not acquire evidence guarantees without reanalysis.

### AI Provider Environment Variables

- `AI_PROVIDER`: `local`, `openai`, `gemini`, or `groq`.
- `OPENAI_API_KEY` / `OPENAI_MODEL`
- `GEMINI_API_KEY` / `GEMINI_MODEL`
- `GROQ_API_KEY` / `GROQ_MODEL`

The frontend always shows AI output as a draft. Calendar events are created only after the user clicks `Apply Drafts`.

## Atomic draft application

### `POST /api/journals/{id}/apply-drafts`

```json
{ "analysisId": "id-of-reviewed-analysis" }
```

The server validates and applies the stored analysis in one SQLite transaction. The client cannot substitute draft content. Response 201 for first application, 200 for a replay:

```json
{
  "journalId": "journal-id",
  "analysisId": "analysis-id",
  "events": [],
  "appliedAt": "2026-10-02T01:00:00.000Z",
  "replayed": false
}
```

`events` contains all created event objects and their original IDs. Retrying the same analysis returns the original receipt without creating events. A receipt survives restarts and reanalysis. Errors: 400 for invalid draft fields or invalid body, 404 for a missing journal, 409 for a stale/unavailable analysis. All failures roll back batch writes. Analysis GET responses include `applied: true/false`. Journal content/date/type edits invalidate old analyses. Journal deletion removes analyses and receipts, while already applied events remain independently editable.

Event timestamps require ISO date-times with timezone and a strictly positive duration. Partial event updates are validated after merging with the stored event. IDs and creation timestamps are server-controlled. This stage does not guarantee conflict-free scheduling.

For versioned analyses, application validates the contract and checks all journal evidence under the transaction lock. Changed/deleted related sources return `409` before any events are written. New events add `sourceTaskId`, `sourceEstimateId`, and `planningSchemaVersion`. A successful receipt remains replayable after sources change. Internal block overlap/buffers/availability/effort/dependency checks are implemented; conflicts against actual calendar commitments await the scheduler stage.
