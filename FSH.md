# Paseo — FSH fork

Full Stack House's fork of [getpaseo/paseo](https://github.com/getpaseo/paseo). Branch `fsh`
(the default) = upstream `main` + FSH patches that haven't landed upstream yet. The fork is
temporary by design: every patch is meant to go upstream and then drop out of `fsh`.

## Patches on `fsh`

- getpaseo/paseo#7514: chat links to folders outside the workspace open in the file manager
- getpaseo/paseo#7692: Cmd+Shift+[ / ] for previous/next tab on macOS desktop
- getpaseo/paseo#7645: plugins can add items to sidebar workspace rows
- getpaseo/paseo#6220: clients and plugins can see an agent's background work
- FSH-only (not upstream yet): an idle agent's background work (a background shell, a `Monitor` watch) keeps its workspace in Working instead of Done
- FSH-only (not upstream yet): host setting for the mode an agent switches to after plan approval, per provider (Claude, Codex), under host Settings → Agents. Applies to approvals from the app, MCP and CLI
- FSH-only (not upstream yet): changed images in the Changes diff and commit diffs show a before/after preview instead of "Binary file" (PNG, JPEG, GIF, WebP, BMP up to 8 MB per side). getpaseo/paseo#1813 tried this upstream and was closed; discussion getpaseo/paseo#5689 tracks it
- getpaseo/paseo#7955 (cherry-picked, merged upstream): retry brief Windows file locks during atomic writes. Drop at the next refresh
- FSH-only (upstreamable): F-Droid builds link the app's own native modules (`packages/app/modules`); before, `paseo-scroll` was never linked and the build failed to compile
- FSH-only (not upstream yet): the connected-hosts batching test holds the parent's batch with an injected scheduler instead of racing the 2-second quiet window against a cold CLI spawn
- FSH-only (not upstream yet): project categories. Put each project in a category from its menu, then pick a category in the Workspaces header so the sidebar shows only that category's projects. Categories are stored per device
- FSH-only (upstreamable): workspace diffs show unpushed and behind counts (`↑1 ↓327`) in the composer pill and the Changes header, opening a sync card (upstream, uncommitted files, unpushed commits, commits to pull, next step); a branch both ahead and behind its remote offers Pull and push as the primary action

Keep this list in sync with what's merged into `fsh`.

## Install the desktop app (macOS, Apple Silicon)

Requires macOS 13 (Ventura) or newer on Apple Silicon. Install with Homebrew from
[fullstackhouse/homebrew-tap](https://github.com/fullstackhouse/homebrew-tap) — that repo's README covers the tap
itself (trust, signing, how bumps work); this section is the only place with the install steps. The cask follows the
latest FSH release within 30 minutes, links the `paseo` CLI, and clears the quarantine flag the unsigned build needs
cleared.

```bash
brew tap fullstackhouse/tap
brew trust --cask fullstackhouse/tap/paseo-fsh   # one-off, per machine
brew install --cask paseo-fsh
```

Homebrew 6 and newer will not load a third-party tap until you trust it, and trust is recorded per machine — so a new
laptop needs that middle line again. Skip it and you get `Refusing to load cask fullstackhouse/tap/paseo-fsh from
untrusted tap`, not a prompt.

Already have Paseo.app from a DMG? `brew install --cask --adopt paseo-fsh` takes over the existing copy instead of
refusing.

If Homebrew's upstream `paseo` cask is installed, run `brew uninstall --cask paseo` first. Its uninstall hook quits
Paseo and stops the daemon, so do it when no agent is mid-turn. Your `~/.paseo` data and hosts are kept. Leaving the
upstream cask installed is not an option: `brew upgrade` would replace the FSH build with upstream Paseo.

Update with `brew upgrade --cask paseo-fsh`, then **quit Paseo (⌘Q) and reopen it** when no agent is mid-turn. The
quit is not optional housekeeping: unlike the upstream cask, `paseo-fsh` has no `uninstall` stanza, so the upgrade
swaps the app on disk and leaves the old build running, indefinitely.

Nothing in the UI or the CLI will tell you. Every FSH build reports the same `0.13.0-beta.1` from `paseo --version`
and `paseo status` — the part that identifies the build is the commit sha in the _cask_ version
(`0.13.0-beta.1-28159c2`), which the app itself never sees. To check whether you are running what is on disk, compare
the inode the process executes against the file:

```bash
lsof -p "$(pgrep -f 'Paseo.app/Contents/MacOS/Paseo')" | awk '$4=="txt" && /MacOS\/Paseo/ {print $(NF-1)}'
stat -f %i /Applications/Paseo.app/Contents/MacOS/Paseo
```

Two different numbers mean the app was replaced underneath the running copy: quit and reopen. There's no in-app
auto-update either, so this is the whole update path — that needs a Developer ID signed build.

Without Homebrew: download the DMG from the latest [release](https://github.com/fullstackhouse/paseo/releases/latest),
drag Paseo to Applications, run `xattr -cr /Applications/Paseo.app`, and install the CLI from **Settings →
Integrations**.

Then install at least one agent CLI (Claude Code, Codex) and `gh`, both signed in. Paseo runs them; it doesn't ship
one. To go back to upstream, `brew uninstall --cask paseo-fsh && brew install --cask paseo`.

A DMG built before the `hardenedRuntime=false` fix dies at launch on macOS 26 with
`Library not loaded: @rpath/Electron Framework.framework/Electron Framework` and
`different Team IDs`. Download a newer DMG, or re-sign the installed copy ad-hoc:

```bash
codesign --force --deep --sign - /Applications/Paseo.app
```

That drops hardened runtime, which is what blocked the load. It also drops the
entitlements, including `com.apple.security.device.audio-input` — so prefer a newer
DMG if you use voice input.

## Install the Android app

Our own build of the mobile app, from `fsh`: package `house.fullstack.paseo`, installs next to
the store app. It is built without Google services, so it has **no push notifications** and no
QR pairing.

1. On the phone, open **[paseo-fsh-arm64.apk](https://github.com/fullstackhouse/paseo/releases/download/fsh-android-latest/paseo-fsh-arm64.apk)**,
   a link that always serves the newest build, or scan:

   <img src="docs/fsh/android-apk-qr.png" width="160" alt="QR code: Paseo FSH Android APK">

   **Automatic updates:** install [Obtainium](https://github.com/ImranR98/Obtainium) and add an app:
   source URL `https://github.com/fullstackhouse/paseo`, **Filter release titles by regular
   expression** `^Paseo Android \d`, **Filter APKs by regular expression** `paseo-fsh-.*-arm64\.apk`.
   The title filter matters: most releases here are desktop DMGs with no APK.

2. Allow installs from that app when Android asks.
3. Add hosts as a direct connection: e.g. `jaceks-macbook-pro.tailc790a0.ts.net`, port `443`,
   SSL on, plus the daemon password. Tailscale must be on.

Every build is signed with the FSH key (GCP Secret Manager: `paseo-android-keystore`,
`paseo-android-keystore-password`; GitHub secrets `PASEO_ANDROID_KEYSTORE_BASE64`,
`PASEO_ANDROID_KEYSTORE_PASSWORD`). Android only accepts updates signed with the same key, so
never rotate it casually.

## FSH plugins

These work on upstream Paseo too (0.12+). First turn on **Settings → Plugins → Enable plugins** on the daemon, then install each plugin on every daemon you use:

```bash
git clone git@github.com:fullstackhouse/<plugin>.git
cd <plugin> && npm install && paseo plugin install "$PWD"
paseo plugin ls   # should show "running"
```

- [paseo-asks](https://github.com/fullstackhouse/paseo-asks): what agents need from you (decisions, PRs to merge, manual steps), as a list with answer buttons
- [paseo-status](https://github.com/fullstackhouse/paseo-status): a plain-language status card per agent, written by the agent
- [paseo-limits](https://github.com/fullstackhouse/paseo-limits): Retry and Log in buttons on usage-limit, login and connection errors
- [paseo-prs](https://github.com/fullstackhouse/paseo-prs): composer pills for an agent's PRs, with Create PR when there is none

Agents that already existed when a plugin was installed don't get its MCP tools. Start a new agent.

## Working on the fork

- **Upstreamable change**: open the PR against `getpaseo/paseo` from your personal fork, then merge
  its branch into `fsh` and add it to the list above.
- **FSH-only change**: open a PR against `fsh` on this repo. CI runs on it.
- **Refresh**: recreate `fsh` from `upstream/main`, re-merge the still-open patches, drop the ones
  upstream merged, and keep the `fsh`-only commits (this file, the pointers at the top of
  `README.md` / `CLAUDE.md`, `.github/workflows/fsh-desktop.yml`, `.github/workflows/fsh-android.yml`,
  the `fsh` variant in `packages/app/app.config.js` and `plugins/with-fsh-release-signing.js`).
- **Build**: every push to `fsh` (except edits to this file, `README.md` or `docs/fsh/`) builds the DMG and the Android APK
  and publishes a release for each (`fsh-*`, `fsh-android-*`).
  The build runs upstream's packaged-app smoke test first. You can also start it by hand:
  Actions → FSH desktop build → Run workflow.
- **Upstream workflows**: they trigger on pushes to `main` and on `v*` tags, and need upstream's
  secrets. Don't push `main` or `v*` tags here. Our release tags are `fsh-*`.
