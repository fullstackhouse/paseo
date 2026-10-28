---
name: run-paseo
description: Run this Paseo branch as a second Paseo (own daemon + desktop window) next to the one the user works in, with their real config and plugins, to see or verify a change. Use when asked to run, try, test, or screenshot a Paseo change locally, or to test a Paseo plugin against this branch.
user-invocable: true
---

# Run this branch next to the main Paseo

Follow [Test a change next to your main Paseo](../../../docs/development.md#test-a-change-next-to-your-main-paseo). For a plugin change, follow [Test a plugin change](../../../docs/plugins.md#test-a-plugin-change).

- Never start, stop, or reload plugins on the daemon on `6767`. It runs you.
- Start the `daemon` and `desktop` workspace scripts from this worktree; read ports and terminal IDs from `paseo script ls --json`, and output from `paseo terminal capture <terminalId>`.
- Your `PASEO_HOME` is the main daemon's. Pass `--home .dev/paseo-home` to every `paseo` command aimed at the branch; never use `npm run cli` for it.
- Prove it works before handing over: `paseo plugin ls --home .dev/paseo-home` shows the plugins `running`, and a screenshot of the window shows projects, not "Password required". Electron prints a `DevTools listening on ws://127.0.0.1:<port>` line; connect Playwright over CDP to that port to take it.
- Tell the user which window is the branch (titlebar shows the branch name) and leave both scripts running for them. Stop them when the user is done.
