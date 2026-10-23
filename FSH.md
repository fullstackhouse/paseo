# Paseo — FSH fork

`fsh` = upstream `main` + FSH patches not yet merged upstream:

- getpaseo/paseo#7514 — open chat links to folders outside the workspace
- getpaseo/paseo#7692 — Cmd+Shift+[ / ] for previous/next tab on macOS
- getpaseo/paseo#7645 — plugins can add items to sidebar workspace rows
- getpaseo/paseo#6220 — expose agent background work to clients and plugins
- FSH patch (not upstream yet) — an idle agent's background work keeps its workspace in Working, not Done

## Install (macOS, Apple Silicon)

1. Download the DMG from the latest [release](https://github.com/fullstackhouse/paseo/releases).
2. Drag Paseo to Applications (replaces upstream Paseo; settings are kept).
3. The build is unsigned, so run once: `xattr -cr /Applications/Paseo.app`

No auto-update: reinstall from Releases. Back to upstream: install from paseo.sh.

## Maintain

- Refresh: rebuild `fsh` from `upstream/main` and re-merge open PRs; drop merged ones.
- Build: run the **FSH desktop build** workflow on `fsh` (Actions → Run workflow).
