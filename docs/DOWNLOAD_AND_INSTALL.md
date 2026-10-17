# Download and install

Status checked on **17 October 2026 (Asia/Shanghai)**. A Windows x64 test installer has been built and validated locally. There is currently **no published GitHub Release**. The latest login/onboarding and validation changes are local commits until pushed; source downloaded from the default branch can therefore be older.

## Windows test build available now

The implementation's build output is `release/Agent Planning Calendar Setup 0.3.0.exe`. A copy of the validated installer, `SHA256SUMS.txt` and this note is supplied beside the local validation report. Use that installer copy to install this tested revision. The complete app is included; Node.js and pnpm are not needed to run the installer.

1. Obtain **Agent Planning Calendar Setup 0.3.0.exe** and **SHA256SUMS.txt** from the same build.
2. In PowerShell, run `Get-FileHash -LiteralPath '.\Agent Planning Calendar Setup 0.3.0.exe' -Algorithm SHA256` and compare the result with the file's line in `SHA256SUMS.txt`.
3. Run the installer. This is a per-user Windows x64 test build. It is **not digitally signed**; Windows may identify its publisher as unknown. Verify the expected source and checksum before choosing to install it.
4. Open **Agent Planning Calendar** from the Start menu. Choose **Continue offline**, then complete timezone, planning-hours and AI setup. Local rules need no service key.
5. Email sign-in becomes available after the Supabase URL, publishable key and email-code templates are configured. Follow [Login and onboarding](LOGIN_ONBOARDING.md). Google Calendar and AI service setup are separate choices.

The checksum detects a different or damaged file; it is not a substitute for publisher signing. This build retains the default Electron icon. It is a test distribution, with the remaining release checks listed in [Release validation](RELEASE_VALIDATION.md).

## Download from GitHub Actions after validation is pushed

The CI changes add a **windows-validation-installer** artifact after Windows packaging and packaged-app acceptance pass. That artifact is not available until this branch is pushed and its new CI run completes successfully.

1. Sign in to GitHub and open [Actions](https://github.com/kyee179/Agent_summarize_planning/actions).
2. Select a successful **CI** run for the intended branch and commit. Confirm its **Windows installer and packaged acceptance** step passed.
3. At the bottom of the run, download **windows-validation-installer** under **Artifacts**. Extract the ZIP and use the Setup EXE with its checksum file. Artifacts are retained for 30 days.

The separate **Release** workflow builds Windows, macOS and Linux installer artifacts for a tag or manual run. It uses `--publish never`: it does not create a GitHub Release. Its artifacts are named `study-calendar-windows-latest`, `study-calendar-macos-latest` and `study-calendar-ubuntu-latest`. These names describe the build runner; inspect the actual file architecture before installing. The current local validation covers Windows x64 only.

## Public release downloads later

Use the repository's [Releases page](https://github.com/kyee179/Agent_summarize_planning/releases) when an intended version and its installer assets are published. Windows users need the Setup `.exe`, macOS users the matching `.dmg`, and Linux users the matching `.AppImage`. GitHub's automatic **Source code (zip)** and **Source code (tar.gz)** links contain source, not an installed application. No release/tag or public installer has been published by this validation work.

## Build from source

Install Node.js **24.18 or newer** and pnpm. Check out the intended revision, then run:

```powershell
pnpm install --frozen-lockfile
pnpm release:check
pnpm build:desktop --publish never
pnpm release:checksums
```

The installer and `SHA256SUMS.txt` appear in `release/`. To run development mode instead, use `pnpm setup:env` and `pnpm dev`. Keep `.env` private. Source builds require development tools; the prebuilt Windows installer includes its runtime.

## Existing users and stored data

This app's installation identity is **Agent Planning Calendar** (`com.agent.planning.calendar`). It does not automatically replace or migrate the older Calendar_App installation. Preserve that installation and its backups until an explicit migration is agreed. The validated database migration uses invented v2 data for this app, not a personal Calendar_App installation.

Normal packaged data is under the operating-system user-data folder, typically `%APPDATA%\agent-summarize-planning` on Windows. Account → Export workspace creates a portable personal export. For a full device backup, close the app and preserve its whole user-data directory, including `accounts.sqlite`, the original `calendar.sqlite`, `profiles/` and encrypted configuration. OS-encrypted files depend on the OS account; copying them is not a promise that they can be unlocked on another computer. Exports and journal databases contain personal information.

For an isolated test profile, set `CALENDAR_PROFILE_DIRECTORY` to a new absolute directory before launching the packaged executable. The app uses it for both application and browser-session storage. A separately set `CALENDAR_DB_PATH` still overrides the database path; remove that override for a fully isolated default database. Relative profile directories and filesystem roots are rejected. This changes storage location only and does not bypass authentication.
