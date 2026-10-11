# Data Schema

Data is stored in `server/data/calendar.sqlite` during development and a separate `calendar.sqlite` inside Electron's `userData` directory when packaged. A sibling legacy `calendar.json` is imported once in a transaction and preserved unchanged. See [STEP_01.md](STEP_01.md) for schema versioning, table layout, transactions, backup, and restoration.

## Legacy import document

```json
{
  "settings": {},
  "events": [],
  "journals": [],
  "journalAnalyses": []
}
```

## Settings

| Field | Type | Description |
| --- | --- | --- |
| `timezone` | string | IANA timezone name, for example `Europe/London`. |
| `locale` | string | Display locale, for example `en-US`. |
| `weekStartsOn` | number | `0` for Sunday or `1` for Monday. |
| `defaultNotifyMinutesBefore` | number | Default reminder lead time. |

## Event

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Unique event identifier. |
| `title` | string | yes | User-facing reminder title. |
| `startsAt` | ISO string | yes | Start date/time. |
| `endsAt` | ISO string | yes | End date/time. |
| `calendarType` | enum | yes | `personal`, `study`, `vacation`, `holiday`, `birthday`, or `other`. |
| `location` | string | no | Optional place. |
| `notes` | string | no | Optional details. |
| `color` | hex string | no | UI color. |
| `notifyMinutesBefore` | number | yes | Minutes before start time. |
| `notificationFormat` | string | yes | User-facing notification style. |
| `repeat` | enum | yes | `none`, `daily`, `weekly`, `monthly`, or `yearly`. |
| `createdAt` | ISO string | yes | Creation timestamp. |
| `updatedAt` | ISO string | yes | Last update timestamp. |

## Future Upgrade Path

Schema version 1 uses separate SQLite tables with JSON payloads and indexed numeric event timestamps. Future migrations will add typed task, evidence, and activity tables without changing existing API record shapes. Applied batch receipts use analysis IDs as unique idempotency keys.

## Journal

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Unique journal identifier. |
| `type` | enum | yes | `daily` or `weekly`. |
| `journalDate` | date string | yes | Journal day or week start date in `YYYY-MM-DD` format. |
| `title` | string | yes | User-facing journal title. |
| `content` | string | yes | Journal body text. |
| `bookmarked` | boolean | yes | Whether this is a precious/saved journal. |
| `tags` | string[] | no | Optional user tags. |
| `createdAt` | ISO string | yes | Creation timestamp. |
| `updatedAt` | ISO string | yes | Last update timestamp. |

## Journal Analysis

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Unique analysis identifier. |
| `journalId` | string | Source journal. |
| `provider` | string | `openai`, `gemini`, `groq`, `local`, or `local-fallback`. |
| `summary` | string | Short analysis summary. |
| `weeklySummary` | string | Weekly reflection generated from available journal context. |
| `tasks` | object[] | Extracted tasks with priority, urgency, duration, confidence, and reason. |
| `scheduleDrafts` | object[] | Draft calendar blocks. These do not become events until applied. |
| `cautions` | string[] | Provider or confidence warnings. |

## Planning contract version 1

New journal analyses contain `contract` with separate evidence, task, estimate, and plan records. Review the exported [evidence](schemas/v1/evidence.json), [task](schemas/v1/task.json), [estimate](schemas/v1/estimate.json), [plan](schemas/v1/plan.json), and [bundle](schemas/v1/bundle.json) JSON schemas. [STEP_02.md](STEP_02.md) explains every field and the cross-record invariants.

The contract is stored inside `analyses.data`; SQLite remains database version 1. Contract versions and database versions evolve independently. Task/estimate IDs are local to an analysis. Dedicated lifecycle tables and cross-analysis identities will be designed with future task editing flows.

Workflow-owned source versions detect changed journals. `source_matched` means an excerpt exists in the referenced snapshot, not that its claim is true. Unknown deadlines are null. Unknown estimates have null effort and unknown confidence; known effort has low/expected/high minutes plus scope (remaining task or next session). A next session never proves completion.

Calendar events created from versioned plans include `sourceAnalysisId`, `sourceTaskId`, `sourceEstimateId`, and `planningSchemaVersion`. Root analysis `tasks` and `scheduleDrafts` are compatibility projections, not an independent source of task truth. Legacy analyses remain readable and applicable under their previous validation.

## Deterministic scheduling metadata

New analyses contain a separate `scheduling` object described by [scheduling.json](schemas/v1/scheduling.json). It records `version: 1`, `algorithm: greedy-v1`, `calendarFingerprint`, `settingsFingerprint`, `availabilitySource` (settings or request), and `notBefore`. The canonical contract and SQLite schema remain version 1. Old saved records remain readable without this metadata.

Effective occupancy hashes include only busy time (with buffers) intersecting the target day's availability. They ignore titles/notes and unrelated days. Settings hashes cover timezone and, when default availability was used, the default window clocks. They detect changed inputs rather than authenticate content. Apply checks them while holding the event-write lock.

Events can store `recurrenceTimezone`, a named timezone for the source repeat clock. New recurring records capture it on create/update. Legacy repeats fall back to the planning timezone. Repeat instances are computed temporarily; there is no extra row per occurrence and no database migration. The validator checks block containment against the merged union of availability. See [STEP_03.md](STEP_03.md) for recurrence, buffers, dependencies, and transaction semantics.
