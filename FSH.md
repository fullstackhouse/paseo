# Paseo — FSH fork

`fsh` = upstream `main` + FSH patches not yet merged upstream:

- getpaseo/paseo#7514 — open chat links to folders outside the workspace
- getpaseo/paseo#7692 — Cmd+Shift+[ / ] for previous/next tab on macOS
- getpaseo/paseo#7645 — plugins can add items to sidebar workspace rows

## Install (macOS, Apple Silicon)

1. Download the DMG from the latest [release](https://github.com/fullstackhouse/paseo/releases).
2. Drag Paseo to Applications (replaces upstream Paseo; settings are kept).
3. The build is unsigned, so run once: `xattr -cr /Applications/Paseo.app`

No auto-update: reinstall from Releases. Back to upstream: install from paseo.sh.

## Maintain

- Refresh: rebuild `fsh` from `upstream/main` and re-merge open PRs; drop merged ones.
- Build: every push to `fsh` builds and publishes a release (or Actions → FSH desktop build → Run workflow).

Upstream workflows are disabled on this fork (they trigger on `main` / `v*` tags and need upstream secrets).
Only **FSH desktop build** stays enabled. Release tags are `fsh-*`, which no upstream trigger matches.
