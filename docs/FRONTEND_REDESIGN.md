# Calendar workspace redesign

The frontend now follows the daily lifecycle: see today's commitments, write a journal, choose analysis context, review a plan, and explicitly add that plan to the local calendar. The redesign uses the agreed Apple-inspired neutral surfaces, blue actions, grouped controls and restrained feedback, with system fonts and ordinary Windows window controls.

## 1. Follow the information through the app

1. **Today** reads the local calendar and imported read-only Google busy times. It links directly to today's journal.
2. **Calendar** shows Month or Agenda, including repeated and overnight occurrences. Selecting a day reveals its events. The event dialog edits local events; a repeating occurrence opens the original series with a clear all-occurrences explanation.
3. **Journal** keeps a working copy separate from the saved record. Saving is explicit. Searching, type filters and bookmarks help retrieve entries. Creating or selecting another entry protects unsaved text; navigation between app destinations keeps the working copy. Narrow windows collapse the history panel.
4. **Plan** uses the selected journal. Customize analysis exposes the target day, optional available hours and per-run permissions. Generate saves changed text first, then requests the existing backend workflow. An unchanged saved entry is not saved again, because that would invalidate its analysis unnecessarily.
5. **Review** compares existing commitments with proposed blocks on one time ruler. The effort range, unknown deadline, evidence, assumptions, warnings and unscheduled reasons remain available. Clicking a proposed block focuses its task evidence. Longer reflection and summary information follows the timeline.
6. **Apply** sends the saved analysis ID. All blocks are applied atomically after the backend's source, settings, calendar and elapsed-time checks. A 409 marks the result stale and requires generation and review again. The interface never silently relocates blocks or retries calendar writes automatically.

Connections and Settings have their own destinations. They no longer compete with journal writing.

## 2. Understand the component responsibilities

| File | Responsibility |
| --- | --- |
| `src/App.jsx` | Application shell, navigation, contextual dialogs, Today view and reminders |
| `src/app/useWorkspace.js` | Load saved records, protect working state, coordinate saving/generation/Apply and report lifecycle changes |
| `src/features/CalendarWorkspace.jsx` | Month/Agenda, correct weekday order, overflow counts and selected-day events |
| `src/features/JournalWorkspace.jsx` | History, filters, writing and save feedback |
| `src/features/PlanWorkspace.jsx` | Preparation, current-calendar snapshot, review and explicit complete-plan Apply |
| `src/features/SettingsWorkspace.jsx` | Timezone, week start, available hours, AI service, reminders and secondary diagnostics |
| `src/components/AnalysisOptions.jsx` | Grouped per-analysis choices, sharing explanation and readiness help |
| `src/components/IntegrationSettings.jsx` | Customer-facing connection actions, saved notes, local search preparation and advanced tools |
| `src/components/Dialog.jsx` | Native modal focus containment, Escape handling and focus restoration |
| `src/components/EventDrawer.jsx` | Local event editing, series explanation, deletion and unsaved-change protection |
| `src/components/DayTimeline.jsx` | Time-aligned current/proposed columns with overlap lanes |
| `src/lib/dates.js` | Named-zone display and input conversion, overlap checks and Google freshness hints |
| `src/api.js` | Existing browser/IPC transport, plus structured status/issues for contextual recovery |
| `server/calendarView.cjs` | Bounded display occurrences using the same recurrence implementation as scheduling |

React owns presentation and transient editor state. The server continues to own evidence, scheduling, permissions, validation and writes. No new UI framework or runtime dependency was added.

The main analysis states are idle, saving, generating, ready, applying and applied, with loading, error and stale branches. Refs prevent duplicate mutations while a request is pending. Generation uses an indeterminate working state because the existing API does not expose streaming progress or cancellation.

## 3. Keep customer choices understandable

Customize analysis begins with all optional sources off. Permission to search past entries, use recorded activity or research the web does not connect an account or start recording. The selected entry and the app's related-journal/calendar context remain part of the existing backend workflow; the explanation identifies that context rather than promising that optional switches suppress it.

Connection actions are named by their outcome:

- Google Calendar: Connect Google Calendar, Refresh calendar, and secondary calendar selection/disconnection controls.
- App activity: Start recording or Pause recording, with visible recording state. Deleting records is available in management controls.
- Goals and notes: Add a note. Prepare past journals builds the existing local keyword index through an explicit customer action; it sends no journal text to an AI service. The user separately permits an analysis to retrieve excerpts.
- Web search: Ready or Setup needed. Per-analysis permission is controlled in Customize analysis. Manual research retains its own explicit query consent.

Provider credentials, ActivityWatch import details, optional embeddings and owner setup are inside advanced/help areas. No credentials are accepted by the journal editor. Google polling remains active while navigating within the app, retains the token-exchange pending state and syncs after consent completes.

Google Connected and Ready for this day are different. The display checks selected-calendar coverage, the planning day plus buffers, and the 30-minute cache age. Refresh retains the selected calendar IDs when available. Backend checks remain authoritative.

## 4. Why the calendar API changed

The ordinary event query returned original recurring anchors. A weekly event created months ago could be absent from a later calendar view even though the scheduler correctly reserved its future occurrences. Drawing a review timeline from that query would have hidden real conflicts.

The backwards-compatible extension is:

```text
GET /api/events?includeGoogle=true&expand=true&from=<ISO instant>&to=<ISO instant>
```

With `expand=true`, both range bounds are required, the end is exclusive, and the range is limited to 62 days. It loads planning-relevant anchors and uses the scheduler's existing `expandEvents` function. It does not require current Google sync coverage just to display cached events; planning and Apply still require fresh coverage.

Each row keeps the original editable event `id`, adds an `occurrenceId` for rendering/reminder identity and carries `anchorStartsAt`/`anchorEndsAt` for series editing. Actual occurrence timestamps drive the display. Calls without `expand=true` retain their existing response behavior. Authentication, browser boundaries and the Electron route allowlist remain in effect.

This preserves the scheduler's timezone and DST behavior: nonexistent recurring clocks are skipped and ambiguous future clocks conservatively reserve both offsets. Event input rejects ambiguous/nonexistent clocks rather than silently changing the time. Overnight intervals appear on every overlapping day. Month ranges now include the complete final displayed day.

## 5. Interaction and visual behavior

Shared tokens define surfaces, text, spacing, separators, corners and action emphasis. Small controls use short transitions with reduced-motion alternatives. Light/dark appearances and forced-color fallbacks are included. Buttons have keyboard focus, hover/pressed and disabled states. The native dialog supplies modal focus containment; closing restores the previous focus target. The desktop window can now shrink to 640 pixels wide; browser layouts also adapt below that width.

The app asks for notification permission from Settings after an explicit action. While the app is open, it checks expanded upcoming occurrences, suppresses duplicate notifications by occurrence, and respects silent reminder format. Recurring edits/deletes affect the entire series; individual occurrence editing is not provided.

## 6. Verification and boundaries

Verification uses synthetic journals, events and temporary databases, with local analysis and mocked integration transports. The full check is `pnpm release:check`, followed by `pnpm smoke:desktop` and `pnpm smoke:web`. Frontend coverage includes default-off source permission, recording separation, unsaved writing, startup recovery, focused event editing and stale Apply requiring another review. Calendar API coverage includes authentication, bounds, old recurring anchors, overnight overlap and DST ambiguity.

Final local result on 16 October 2026: all 164 tests passed (33 frontend, 131 server), with quality policy, lint, offline evaluation, production build and real Electron smoke passing. Browser proxy smoke also passed. Synthetic screenshots were inspected at desktop and 390px widths; the history/reading layout and timeline ordering were refined from that inspection. Duplicate manual-event saves, pausing recording and retaining selected Google calendars during refresh have regression coverage. No new live remote-provider or real-account test was needed for this frontend revision.

The desktop smoke exercises the real preload bridge, saving through the UI, generation through the UI, recurring commitments in the comparison, optional-source defaults, dormant recording, and diagnostics. Existing Apply/replay/security checks remain. Setting `CALENDAR_UI_CAPTURE_DIRECTORY` optionally saves synthetic screenshots and checks responsive horizontal overflow. Captures disable visual transitions to avoid sampling intermediate states in hidden windows.

The existing backend limitations remain: complete-plan Apply, single-day scheduling, no task editing/partial acceptance, no durable task-completion manager, no task splitting, no streamed generation/cancellation and no Google calendar writes. The frontend change does not establish new remote model or integration quality. Credentials, personal databases and the existing Google connection are outside this revision's verification.

## 7. Version control

Work is isolated on `codex/frontend-redesign`. The 25 original user documentation edits are preserved and excluded from the feature commit. The one necessary `server/index.cjs` hook is prepared against HEAD for the index, while the user's working-file comments remain intact. Other files are staged by explicit scope. No production database, journal, activity record, credential or environment file belongs in the commit.

This source revision does not create a release tag, change the installed app identity, or perform an upgrade migration. Restart or reload the development app to load the rebuilt frontend; a distributable installer remains a separate release step.
