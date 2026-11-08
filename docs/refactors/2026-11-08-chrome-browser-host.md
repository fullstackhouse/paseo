# Chrome browser host for Paseo

Status: skeleton; scope decision pending. No implementation or live authentication test completed.

## TLDR

Let Claude and Codex agents use a user's existing Chrome profile through Paseo, including agents running on another machine. The proposed browser host preserves Chrome's installed 1Password extension and lets the user complete passkey authentication before the agent resumes. Paseo owns routing, task ownership, and the human handoff; agent-browser is a candidate local execution backend.

## Open Questions

- **Q1 — Scope split:** Make this spec cover the Chrome host, shared-browser task queue, and authentication pause/resume; put guaranteed background phone delivery and general desktop control in separate follow-up specs? Recommended: yes. Existing Paseo notification delivery is reused where available, with its limitations visible.

## Problem Statement

The user runs several Claude and Codex workspaces and frequently signs in using passkeys stored in 1Password. Agents need access to a browser on the user's Mac even when their workspace runs on another host. Concurrent agents must not change each other's browser targets or interrupt authentication.

Paseo already routes workspace-scoped browser tools through its daemon to a connected desktop browser host. Its embedded browser shares a Paseo profile; the inspected implementation has no supported 1Password extension installation flow. Browser routing is therefore reusable, but the embedded browser does not establish the required Chrome-extension workflow.

The mobile app can direct an agent, but its browser pane does not provide a live remote desktop or browser view. A phone notification or Continue action does not perform a passkey ceremony on the Mac.

## Proposed Solution

Add an explicitly selected Chrome browser host on the Mac. Keep the existing embedded browser available for work that does not need Chrome's profile or extensions. Both Claude and Codex use the same Paseo-facing contract; neither needs its vendor's native browser integration.

The Chrome host would execute locally against a user-approved Chrome profile with the existing 1Password extension. Evaluate agent-browser's existing-Chrome connection as the backend; do not assume its CLI session isolation proves isolation when several sessions attach to the same browser.

Proposed first-release behavior:

1. The user opts a Chrome profile into Paseo and selects the desktop that will host it. Do not silently choose another desktop, profile, or default tab when the selected target is unavailable.
2. An agent requests browser access for a bounded task. One task owns the shared Chrome resource at a time; other workspaces wait in a visible queue. Ownership spans observation, interaction, and verification, not individual clicks.
3. The agent reaches authentication and explicitly requests human intervention. Automatic prompt detection may assist but must not be the only way to pause.
4. Paseo pauses automation, identifies the requesting workspace and site, and offers the user an attention card. Existing notification delivery may alert the user; delivery and acknowledgement are separate states.
5. The user completes 1Password/passkey approval in Chrome on the Mac, then chooses Continue. The agent checks the page for successful authentication before proceeding; Continue is not proof of login.
6. Completion or cancellation releases ownership after in-flight work has stopped. Disconnection, process failure, and uncertain command completion must not allow another task to race an old owner.

The host must enforce ownership at dispatch. A skill asking agents to cooperate is not sufficient. Coordination covers clients using this host; unrelated tools that directly control Chrome remain outside that guarantee.

### Boundaries and evidence

- Reuse existing authenticated Paseo transport; do not expose Chrome's debugging endpoint as a public remote-control API.
- Keep credentials and passkeys in Chrome/1Password. Do not add password fields to attention cards or persist authentication screenshots as queue metadata.
- Browser host selection is distinct from connected-daemon registration. A saved remote host does not automatically authorize reverse access to the user's Mac.
- A desktop-side backend and remote plugin runtime are different deployment locations. Whether current plugin APIs can register and execute this browser host without core changes remains to be established.
- Preserve protocol parsing compatibility and gate the new feature once. Exact message and capability names follow contract discovery after the scope decision.
- Existing plugin notifications prefer one in-app recipient when a client is present. The FSH Android build lacks push support. This draft does not promise background phone delivery on that build.
- No general native-app control, mobile screen streaming, remote Touch ID approval, or automatic credential extraction is proposed here.

## Phasing

### Phase 1 — Prove remote Chrome and passkey handoff

Use an isolated development setup. A Claude agent on a remote host must reach a real site in the selected Mac Chrome profile, pause for a user-completed 1Password passkey sign-in, and resume after verifying success. Repeat the browser workflow with Codex. Record versions, permissions, browser connection requirements, and whether the host interface needs core changes.

### Phase 2 — Specify and implement ownership and recovery

After the proof succeeds, finalize host identity, tab ownership, queue state, cancellation, human takeover, reconnect, and stale-owner fencing. Add Paseo attention UI using existing surfaces. Any changes to mobile notification delivery or native desktop control receive separate specs if Q1 is accepted.

## Implementation Plan

This skeleton defines verification before implementation. Expand these steps into contracts and tests after Q1 is answered.

1. Trace browser host registration, request routing, authority, and disconnect cleanup. Establish the extension point and minimum core changes rather than assuming a plugin-only implementation.
2. Run the Phase 1 proof without restarting the main Paseo daemon. A documented integration path is the deliverable; stop and revise the design if Chrome/1Password cannot complete the real workflow.
3. Define the resource owner and lease lifecycle. Demonstrate that two agents cannot mutate the shared browser concurrently, including during human intervention and after a reconnect.
4. Add queue and attention states with explicit Continue and Cancel. Verify that failed login remains actionable, stale Continue actions are rejected, and duplicated notifications do not resume work twice.
5. Verify a remote-agent/local-Chrome topology, Claude/Codex parity, cancellation, browser closure, desktop loss, and old-client/new-daemon compatibility in existing test suites. Record live passkey evidence without recording secrets.

## Sources and review limits

Repository sources inspected:

- [Browser routing and shared-profile contract](../../public-docs/browser.md).
- [Mobile browser placeholder](../../packages/app/src/desktop/browser/pane/index.tsx).
- [Connected-host authority](../connected-hosts.md).
- [Plugin notifications](../plugins.md) and [FSH Android delivery limitations](../../FSH.md).
- [Protocol compatibility](../protocol-compatibility.md).

External research from this conversation:

- [agent-browser existing Chrome connection and tab pinning](https://agent-browser.dev/cdp-mode).
- [agent-browser sessions](https://agent-browser.dev/sessions).
- [1Password browser passkeys](https://support.1password.com/save-use-passkeys/).
- [Paseo Claude Chrome integration issue #8913](https://github.com/getpaseo/paseo/issues/8913).
- [Claude shared browser-selection issue #88057](https://github.com/anthropics/claude-code/issues/88057).

These establish component capabilities and reported limitations, not an end-to-end test of this proposal. The precise browser-host extension contract, passkey flow, enforcement boundaries, and mobile delivery require validation. Architectural and scope-cohesion review follows the completed design.
