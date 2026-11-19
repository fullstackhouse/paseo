# Verification — 19 November 2026

## Isolated end-to-end run

Ran the worktree daemon and Electron window in `.dev/paseo-home`, separately from the main Paseo instance. Used installed agent-browser 0.43.0, disposable headless Chrome 157, and two Claude Opus 5.5 agents in different workspaces.

- First agent opened its owned tab, observed the fixture, clicked its button, verified `CLICK VERIFIED`, and handed off.
- Second agent remained queued while the first was held. It had no tab yet.
- Clicking Continue in the branch desktop window woke the first agent. It took a new snapshot and finished, closing its tab.
- The plugin then woke the second agent. It opened a different tab, clicked and verified the fixture, and handed off.
- Cancel retained the human hold. Return control released the reservation and closed only that task's tab.
- Chrome's remaining page list contained only the original `about:blank` tab. The fixture counted exactly two clicks.
- Disabled tasks through Setup, archived only the test agents, and stopped the disposable Chrome. The isolated plugin and desktop remain available for inspection.

This handoff was simulated; no credentials were entered. The earlier real Claude/1Password proof is recorded in the [Chrome host proposal](../../docs/refactors/2026-11-08-chrome-browser-host.md). This run does not re-prove passkeys, remote-host routing, mobile rendering, or phone push delivery.

The initial smoke run used the main instance under the previous repository testing instructions. After the user requested isolation, removed that plugin, archived its test agents, and stopped its disposable Chrome; the main daemon was never restarted. The final workflow above ran entirely on the separate instance. Repository instructions now require isolated plugin testing.

## Failure checks

Live testing exposed macOS's Unix socket path limit. Shortened generated sessions to 96-bit random suffixes and verified recovery of the failed older session through the UI. Reloaded-plugin recovery preserves blocked ownership until the previous executor and debugging connection are gone.

Thirty-five targeted tests pass: 19 engine, seven backend, nine service. They cover owner binding, queue order, task revisions, cancellation during lock acquisition, human holds, restart recovery, stale refs and request IDs after Continue, backend argument boundaries, socket recovery, admission/config races, wake failures, and dropped notifications.

Repository typecheck, plugin typecheck, and repository lint pass. Formatting applied with the repository script. No full local test suite was run.

The correct Electron branch window was visually checked. Its initial host startup error cleared using Retry. Read-only console capture during the final UI actions (10:33:29–10:34:24 UTC) recorded zero fresh errors, warnings, or exceptions. Buffered host startup warnings included require cycles, React Native Web pointerEvents deprecation, and Electron's development CSP warning; none originated in this plugin.
