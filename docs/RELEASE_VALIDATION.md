# Additional release validation — 17 October 2026

The lifecycle now has separate checks for source correctness, the packaged runtime, the installer, persistent profiles and a download handoff. Development-mode smoke alone cannot establish that a distributed app contains its prompts, dependencies and executable helpers.

## Measured results on this Windows x64 host

| Check | Result and scope |
| --- | --- |
| Core release gate | 230 tests: 47 frontend and 183 server, including two new profile-directory safety cases; quality policy, lint, offline evaluation and frontend build passed |
| NSIS installer | Version 0.3.0 built successfully with Electron 43.1.0 / electron-builder 26.15.3; per-user x64 installer, approximately 104 MB |
| Packaged content | 9,753 archive entries checked for forbidden private paths; 62 first-party runtime files matched their build inputs; required skills/prompts, Supabase SDK use at runtime and external Windows helper present |
| Fresh packaged app | Starts locked, opens an explicitly selected local profile, completes onboarding and executes the trusted preload/API bridge |
| Chinese/local planning | Full-width API text and emoji survive save/restart; Chinese local analysis, CJK note search, task/session links and idempotent Apply passed |
| Restart | Journal, encrypted synthetic service setup and durable tasks persist; previously scheduled work produces zero duplicate drafts |
| Database recovery | SQLite v3 integrity/foreign-key checks and online backup/reopen passed; a synthetic v2 journal and CJK index survive migration; the pre-migration snapshot remains a valid v2 database |
| Actual installation | The real Setup EXE installed into a checked temporary location after verifying no existing installation/shortcut would be replaced; installed executable passed the same acceptance checks; silent uninstall and registry cleanup passed |
| Signing | Authenticode reports **NotSigned**; builder log text mentioning signing does not establish a publisher signature |
| Privacy | Only invented data and new temporary profiles used. The user's development database, real service credentials and Calendar_App installation were not opened, migrated or replaced |

The unpacked and installed-app reports were compared to verify the same archive. Final installer bytes and rebuilt packages are identified by their accompanying checksum/report files; rebuilding can change installer metadata and hashes. The installer is supplied locally with `SHA256SUMS.txt`. No GitHub Release was found when checked; no tag, release publication or merge is part of this validation.

## Code and responsibilities

1. `electron/profileDirectory.cjs` accepts an explicit absolute `CALENDAR_PROFILE_DIRECTORY` before Electron startup. It separates user data and browser-session storage for acceptance tests and rejects filesystem roots/relative paths. Normal launches retain their existing location.
2. `scripts/validate-package.cjs` audits ASAR contents and source hashes, then launches the real packaged executable with loopback-only debugging and synthetic, temporary profiles. It exercises first-run UI, protected IPC, Chinese planning, encrypted service setup, restart and migration. The debugging port belongs only to those temporary test processes and is closed with them; no testing hook or authentication bypass is shipped in the app.
3. `scripts/release-checksums.cjs` writes SHA-256 lines for distributable files, excluding transient uninstaller files. The download handoff includes those checksums.
4. CI adds a Windows packaging/acceptance step and a 30-day installer artifact. The Release workflow adds hosted synthetic smoke, packaged Windows acceptance and checksums. It still publishes Actions artifacts only. Those workflow changes have not yet produced a new hosted CI result while local.

## Repeat the checks

```powershell
pnpm release:check
pnpm smoke:desktop
pnpm smoke:auth
pnpm smoke:web
pnpm build:desktop --publish never
pnpm validate:package 'release/win-unpacked/Agent Planning Calendar.exe' 'evaluation/reports/packaged-windows.json'
pnpm release:checksums
```

The packaged validator operates on an unpacked or already-installed executable, using its own temporary profiles. It does not install/uninstall an app automatically. The separate, guarded local NSIS test performed that installation check on this host. Do not perform automated installation acceptance over an existing user installation.

## Remaining public-release acceptance

- Actual Supabase project configuration, email delivery/templates, live recovery and token renewal remain deferred by the user's choice. Synthetic SDK tests are not a production-service result.
- Signing credentials and macOS notarization are not configured. This is an unsigned Windows test installer with the default icon.
- A clean VM/machine and installed macOS/Linux builds have not been tested. Hosted workflows are prepared; earlier CI success belongs to the older Chinese-handling commit, not this revision.
- Native Microsoft Pinyin candidate selection, actual OS reminder delivery/focus-assist behavior and notification interaction still require manual acceptance. Unicode persistence and simulated composition do not replace these checks.
- No new independent multilingual holdout, actual Chinese embedding-model quality assessment or paid live-provider benchmark was performed. Earlier GLM wording variability remains documented in [Chinese language handling](CHINESE_LANGUAGE.md).
- The older Calendar_App installation has a different identity; automatic upgrade/migration from that installation remains unimplemented. The recovery check establishes readable snapshots, not that an older binary can open a newly migrated v3 database.

Download paths, first-run instructions, version selection and backup scope are in [Download and install](DOWNLOAD_AND_INSTALL.md). Technical references: [electron-builder v26 NSIS](https://www.electron.build/v26/docs/nsis/) and [application contents](https://www.electron.build/v26/docs/contents/).
