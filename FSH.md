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
- FSH-only (upstreamable): hovering a sidebar workspace row shows an Archive button beside its menu, so archiving takes one click. Off by default; turn it on under Show > Archive button in the sidebar's display menu. Desktop and web only; touch keeps the menu
- FSH-only (not upstream yet): project categories. Put each project in a category from its menu, then pick a category in the Workspaces header so the sidebar shows only that category's projects. Categories are stored per device
- FSH-only (not upstream yet): docs and a `paseo-run` skill for running a branch, or testing a plugin, next to the Paseo you work in
- FSH-only (not upstream yet): new workspaces branch off the repo's default branch, not whatever branch the source checkout is on. The daemon picks the ref: the default branch's upstream (any remote), then origin's copy, then local
- FSH-only (not upstream yet): remove a project from its settings page (Settings → Projects → project → Danger zone), not just from the sidebar menu
- FSH-only: the desktop app's update callout installs new FSH builds through `scripts/install-fsh.sh` (see Install below)
- FSH-only (upstreamable): **Create PR & Merge** in a feature branch's git menu asks the workspace's agent to commit, push, open the PR, get CI green and merge. With no agent in the workspace, it opens a new agent tab with that prompt filled in. Shown until the branch has a PR
- FSH-only (upstreamable): workspace diffs show unpushed and behind counts (`↑1 ↓327`) in the composer pill and the Changes header, opening a sync card (upstream, uncommitted files, unpushed commits, commits to pull, next step); a branch both ahead and behind its remote offers Pull and push as the primary action

Keep this list in sync with what's merged into `fsh`.

## Install the desktop app and plugins (macOS, Apple Silicon)

Requires macOS 13 (Ventura) or newer on Apple Silicon. One script installs the latest FSH release, links the `paseo`
CLI, and installs or updates the [FSH plugins](#fsh-plugins). Run it again to update:

```bash
curl -fsSL https://raw.githubusercontent.com/fullstackhouse/paseo/fsh/scripts/install-fsh.sh | bash
```

When a newer build is out, the script quits Paseo and stops the daemon before swapping the app, so run it when no agent
is mid-turn. It asks first; `--yes` skips the question. Every FSH build reports the same `0.13.0-beta.1`, so neither
the app nor the daemon notices a swap underneath it — that's why the script stops both. It records the installed
release tag in `~/.paseo/fsh-release` and does nothing when that matches the latest (`--force` reinstalls).

To see which build you're running, open Paseo → About Paseo: it shows the commit (`Version 0.13.0-beta.1 (fsh.<sha>)`),
the build time, and links to the release and the commit.

It also removes the Homebrew `paseo-fsh` or upstream `paseo` cask if either is installed, since `brew upgrade` would put
its own build back. Your `~/.paseo` data and hosts are kept. Plugins you installed from a local directory are left
alone. `--no-plugins` skips the plugin step.

Once installed, Paseo checks every 30 minutes whether GitHub's latest release is newer than its own build (`fshBuild`,
the release tag stamped into the app). If it is, an **Update available** callout appears at the bottom of the sidebar.
**Install & restart** runs this script with `--yes` in the background and writes its output to `fsh-update.log` in
the app's log folder (`~/Library/Logs/Paseo`). Settings → App updates runs the same check. If the app was replaced on
disk some other way, the callout offers a plain restart. Builds from before this updater have no stamp, so run the
script by hand once.

Then install at least one agent CLI (Claude Code, Codex) and `gh`, both signed in. Paseo runs them; it doesn't ship
one.

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

These work on upstream Paseo too (0.12+). The [install script](#install-the-desktop-app-and-plugins-macos-apple-silicon) enables plugins and installs all of them on the local daemon. On another daemon:

```bash
paseo daemon config set pluginsEnabled true && paseo daemon reload
paseo plugin install git:fullstackhouse/<plugin>
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
  `README.md` / `CLAUDE.md`, `.github/workflows/fsh-desktop.yml`, `.github/workflows/fsh-android.yml`, `scripts/install-fsh.sh`,
  the `fsh` variant in `packages/app/app.config.js` and `plugins/with-fsh-release-signing.js`).
- **Build**: every push to `fsh` (except edits to this file, `README.md` or `docs/fsh/`) builds the DMG and the Android APK
  and publishes a release for each (`fsh-*`, `fsh-android-*`).
  The build runs upstream's packaged-app smoke test first. You can also start it by hand:
  Actions → FSH desktop build → Run workflow.
  To test a PR's desktop build, add the `deploy` label: every push then publishes a prerelease `fsh-pr<N>-<sha>`
  with the DMG (a manual run on another branch publishes `fsh-test-<sha>`). `install-fsh.sh` and the in-app updater
  only install the latest release, which never points at a prerelease. Closing the PR deletes its prereleases.
- **Upstream workflows**: they trigger on pushes to `main` and on `v*` tags, and need upstream's
  secrets. Don't push `main` or `v*` tags here. Our release tags are `fsh-*`.
