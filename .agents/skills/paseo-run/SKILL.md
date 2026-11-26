---
name: paseo-run
description: Run this Paseo branch as a second Paseo (own daemon + desktop window) next to the one the user works in, on its own unseeded home with throwaway test projects, to see or verify a change. Use when asked to run, try, test, or screenshot a Paseo change locally, or to test a Paseo plugin against this branch.
user-invocable: true
---

# Run this branch next to the main Paseo

Follow [Test a change next to your main Paseo](../../../docs/development.md#test-a-change-next-to-your-main-paseo). For a plugin change, follow [Test a plugin change](../../../docs/plugins.md#test-a-plugin-change).

- Never start, stop, or reload plugins on the daemon on `6767`. It runs you. Never connect the branch to it either (no `app-main`).
- Keep the branch's home unseeded: skip `dev:seed-home` and never copy files from `~/.paseo`. Create the states you need in throwaway test projects (a temp git repo). Seed only when the user asks for their real data.
- Bind the branch's daemon to loopback and test agents on the `mock` provider. Use Claude or Codex only when the provider is under test, with your MCP servers kept out ([Test agents](../../../docs/development.md#test-agents)).
- Start the `daemon` and `desktop` workspace scripts from this worktree; read ports and terminal IDs from `paseo script ls --json`, and output from `paseo terminal capture <terminalId>`.
- Your `PASEO_HOME` is the main daemon's. Pass `--home .dev/paseo-home` to every `paseo` command aimed at the branch; never use `npm run cli` for it.
- Prove it works before handing over: `paseo plugin ls --home .dev/paseo-home` shows the plugins the test needs `running`, and a screenshot of the window shows the test project, not "Password required". Electron prints a `DevTools listening on ws://127.0.0.1:<port>` line; connect Playwright over CDP to that port to take it.
- Tell the user which window is the branch (titlebar shows the branch name) and leave both scripts running for them. Stop them when the user is done.
