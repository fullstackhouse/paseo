# Paseo — FSH fork

Full Stack House's fork of [getpaseo/paseo](https://github.com/getpaseo/paseo). Branch `fsh`
(the default) = upstream `main` + FSH patches that haven't landed upstream yet. The fork is
temporary by design: every patch is meant to go upstream and then drop out of `fsh`.

## Patches on `fsh`

- getpaseo/paseo#7514: chat links to folders outside the workspace open in the file manager
- getpaseo/paseo#7692: Cmd+Shift+[ / ] for previous/next tab on macOS desktop
- getpaseo/paseo#7645: plugins can add items to sidebar workspace rows

Keep this list in sync with what's merged into `fsh`.

## Install the desktop app (macOS, Apple Silicon)

1. Download the DMG from the latest [release](https://github.com/fullstackhouse/paseo/releases/latest).
2. Drag Paseo to Applications. It replaces upstream Paseo, and your settings and hosts are kept.
3. The build is unsigned, so run once: `xattr -cr /Applications/Paseo.app`

There's no auto-update: install new builds from Releases. To go back to upstream, install from paseo.sh.

## FSH plugins

These work on upstream Paseo too (0.12+, plugins enabled on the daemon). Install each one on every daemon you use:

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
  `README.md` / `CLAUDE.md`, `.github/workflows/fsh-desktop.yml`).
- **Build**: every push to `fsh` (except edits to this file) builds the DMG and publishes a release.
  The build runs upstream's packaged-app smoke test first. You can also start it by hand:
  Actions → FSH desktop build → Run workflow.
- **Upstream workflows**: they trigger on pushes to `main` and on `v*` tags, and need upstream's
  secrets. Don't push `main` or `v*` tags here. Our release tags are `fsh-*`.
