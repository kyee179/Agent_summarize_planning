# Chinese and English interface — 0.4.0-rc.3

Use **中文** in the top right to switch to Simplified Chinese. In Chinese, the button reads **English**. The button is available on the welcome screen, during onboarding, and on every workspace page. Settings also has an **Interface language / 界面语言** choice.

The choice takes effect immediately and is remembered on this device, including after a reload or account switch. Existing installations keep English until a user chooses Chinese. If browser storage is unavailable, the switch still works for the current session. This preference is shared by workspaces on the same device and is not part of a workspace export.

## How the implementation works

1. **One catalog owns the translations.** `src/i18n/zh-CN.json` maps application-owned English messages to Chinese. English source messages provide the fallback, so an unfamiliar provider diagnostic remains visible. `t(key, values)` interpolates values as text; React escapes them as usual. Known asynchronous message templates are translated when displayed, allowing an already-visible notice to change language too.
2. **One small store owns the preference.** `src/i18n/index.js` validates `en` and `zh-CN`, saves `calendar.uiLanguage` in local storage, updates the document language/title, and notifies React subscribers through `useSyncExternalStore`. Storage events synchronize other open views. No new dependency, backend setting, or database migration is needed.
3. **Components translate their presentation.** `LanguageSwitch.jsx` changes the preference. Sign-in, onboarding, navigation, calendar, journal controls, task review, planning, connections, settings and accessibility labels use the shared catalog. Visible dates, weekdays and times use the selected locale through `Intl`; ISO date keys, timezone calculations and scheduling keep their established behavior.
4. **Stored values remain stable.** A translated option retains an explicit original `value`, such as `open`, `coding` or `Silent reminder`. React keys, API field names and enum values do not depend on language. The language switch does not remount the workspace, save a form, request analysis, change permissions or apply a plan.
5. **Writing and generated content remain verbatim.** Journal/task/event titles, notes, account names, quotations, evidence and AI-generated text are data, so they do not pass through the UI catalog. **Customize analysis → Analysis language** independently controls generated output and retains its existing default of matching the journal language.

## Verification

`pnpm release:check` runs the existing quality, lint, unit/API, offline evaluation and production-build checks. New frontend regressions cover welcome forms, stored preference synchronization, unsaved writing, open dialogs, task/event enum values, source text preservation, date formatting, existing notices and disabled storage. A source catalog gate checks static translation keys and rejects translation calls inside stored option values or React keys.

`pnpm smoke:language` opens a hidden Electron instance with a new temporary profile and invented content. It exercises Chinese welcome/onboarding, reload persistence, all seven workspace pages at 1280px and 390px, switching back to English, unsaved journal text and unchanged analysis permissions. `CALENDAR_UI_CAPTURE_DIRECTORY` optionally captures these synthetic screens. CI and tagged release builds run this smoke on their platforms alongside the existing desktop/auth smoke tests. The temporary profile is removed after the test.

## Release and compatibility

This is a UI update in the existing release-candidate series. App and release policy advance together to `0.4.0-rc.3`. Database schema 4, contract 2, prompts, planning rules and dependency resolutions are unchanged. Back up before upgrading from versions with older schemas; see [release validation](RELEASE_VALIDATION.md) and [planning compatibility](PLANNING_TIMEFRAMES.md). The new release does not replace the separately identified original Calendar_App installation automatically.

Provider-supplied diagnostics that have no catalog entry, operating-system dialogs and external sign-in pages may use their original language. Generated content follows the separately chosen analysis language. Packaging retains the existing signing/notarization limitations; a language smoke verifies the application runtime and layout, not real account consent, native Pinyin candidate selection or clean-machine installation on every OS.
