# Computer control plugin

A local shared-Chrome proof of concept implemented entirely as a Paseo plugin. No Paseo core changes. The three research proposals in `docs/refactors/` describe the broader production design; this plugin implements the local Chrome workflow, not remote-agent enrollment, native Mac control, or forced phone escalation.

## Setup

1. Install agent-browser 0.43.0 separately from its official npm package. No runtime download is performed by this plugin.
2. In the Chrome profile you want to use, open `chrome://inspect/#remote-debugging` and enable remote debugging. Keep it bound to loopback. Chrome may ask you to approve each new debugger connection.
3. Install this directory with `paseo plugin install /absolute/path/to/computer-control`. Existing installations use `paseo plugin reload computer-control`; do not restart the daemon.
4. Open **Chrome control → Setup** in Paseo. Set the absolute agent-browser executable path and Chrome's port or loopback CDP URL; enable tasks and save. Chrome may expose a WebSocket endpoint in its `DevToolsActivePort` file when HTTP discovery is unavailable.
5. In a new or reopened agent turn, ask the agent to use `control_request`, `control_act`, `control_handoff`, and `control_finish`. Tools obtain identity from Paseo, not from model-supplied agent IDs.

Use a disposable profile for initial verification. A dedicated authenticated profile is preferable to unrestricted access to everyday browsing. This plugin is trusted, unsandboxed code, and Chrome's debugging connection exposes that profile to local debugger clients.

## Workflow

- An agent requests one task with a stable request ID, short title and HTTP(S) URL. Queued agents end their turn; the plugin wakes them when their task becomes active.
- The active task observes its own pinned tab and uses element refs for bounded actions. It never adopts existing tabs. Only one task owns the connection, including while you authenticate.
- For login, the agent calls `control_handoff` and ends its turn. Complete authentication directly in Chrome, then click **Continue** in Paseo. Continue wakes the agent to take a fresh snapshot; it does not assert login success.
- **Take control** closes admission and waits for an admitted command to settle. **Cancel** during human control preserves the hold until you explicitly return control. Finishing closes only the owned task tab.
- Snapshots and fill text are not written into the plugin's task journal. They still appear in agent tool traffic and may reach the model provider. Avoid putting secrets in task titles, URLs or handoff reasons.

## Failure and recovery

A timeout does not mean browser execution stopped. The controller blocks new execution after uncertain results, restart or shutdown with outstanding work.

For recovery, finish any human interaction, close the task's test tab, dismiss pending browser/native prompts, disable Chrome remote debugging, and stop the named agent-browser session shown on the task. Quit a disposable Chrome completely if its state is unclear. The backend requires the debugging port to refuse connections and the owned executor process/socket to be absent before recovery succeeds. It does not kill arbitrary PIDs or steal a live controller's lock. Restore the connection afterward before requesting a new task.

The journal lives in `$PASEO_HOME/plugin-data/computer-control` (default `~/.paseo`). A user-wide lock under `~/.cache/paseo-computer-control-owner` prevents other plugin instances from acquiring the same screen. Never delete a live lock to bypass recovery. Tests use explicit isolated directories.

## Scope and limits

- Same-daemon agents across workspaces; phone/desktop UI through existing Paseo connectivity. Remote agent-to-Mac enrollment is not implemented.
- Current-policy notifications only. Desktop presence may suppress phone push.
- Chrome only. No native screenshots/input, arbitrary JavaScript, shell commands, cookie exports, or unrestricted key chords are exposed as tools.
- One session per task pinned by agent-browser. This is cooperative scheduling, not a sandbox against a full-access agent that uses unrelated tools.
- No origin allowlist is claimed for an existing authenticated CDP connection. Page content is untrusted, and all authentication is a human handoff.
- Startup or cancellation with uncertain work requires explicit recovery; there is no automatic replay after restart.

## Development

From the Paseo repository, run `npm run typecheck --prefix plugin-examples/computer-control` and the targeted tests under `server/` using the existing Vitest runner. Use the repository npm lint/format scripts. Use the repository paseo-run skill to start a separate daemon and desktop window. Install this directory with `--home .dev/paseo-home`, and pass that home to every test-agent and plugin command. Never install or reload test code in the main instance.
