# Chrome browser host for Paseo

Status: proposed implementation contract, updated November 18, 2026. Scope split approved (A1). A2 passed a two-local-daemon fixture proof with real Claude/Codex and Chrome; Claude also passed the human-completed 1Password handoff and fresh post-login observation; Codex authentication was waived by the user; real remote networking remains unverified. The opt-in prototype is not a production adapter.

## TLDR

Let Claude and Codex agents, including agents on another machine, use an explicitly selected Chrome profile on the user's Mac. Paseo owns task routing, shared-profile ownership, and human authentication handoff. Qualify agent-browser as the local execution backend before committing to it. Preserve the installed 1Password extension; the user completes passkey authentication locally.

## Scope

This spec owns Chrome access, its task queue, and authentication pause/resume. [Native desktop control](2026-11-17-native-desktop-control.md) owns the shared Mac screen arbiter; [mobile attention delivery](2026-11-17-mobile-attention-delivery.md) owns phone escalation and receipt limits. Chrome must use that same arbiter whenever foreground or native interaction is possible. First release reserves the screen for the entire real-Chrome task, including human authentication.

Keep embedded Paseo tabs available for independent DOM-only work. Do not add vault access, password entry fields, remote Touch ID, mobile screen streaming, or general native-app tools here. The phone can request Continue; it cannot complete a Mac-local authentication ceremony.

## Problem and existing behavior

Several agents may need the same Chrome profile and signed-in sessions. Per-agent CLI sessions do not establish isolation when those sessions attach to one browser. A profile queue must span observation, interaction, and verification, while native prompts also require exclusive screen ownership.

Paseo already routes workspace-scoped browser tools through authenticated daemon connections to a connected Electron browser host. Its embedded profile has no established supported 1Password extension workflow. Browser routing is reusable; existing tabs do not prove the Chrome/passkey requirement.

The existing broker can choose the most recently registered host, and its timeout only settles the caller. Neither is suitable for this feature: selection must be explicit, and timeout cannot prove that browser/native input stopped.

## Architecture and authority

```text
remote Claude/Codex -> Paseo daemon -> selected Mac host registration
                                      -> core Chrome adapter
                                      -> profile reservation -> shared Mac screen arbiter
                                      -> qualified local agent-browser -> selected Chrome profile
```

Core owns host registration, the Mac-local adapter, task admission, and recovery. A plugin may add task UI or notifications; its server code executes on its daemon, not automatically on a connected Mac. Current plugin APIs do not provide this native executor. The implementation requires core desktop/client/protocol integration.

- Reuse authenticated Paseo transport and source-owned registration/observations. Do not publish Chrome's CDP endpoint or give remote agents a direct route around the adapter.
- Select a stable desktop ID and enrolled profile ID explicitly. Never fall back to another host, profile, active tab, or fresh browser when the target is unavailable.
- Local enrollment records permitted daemon identities and the selected profile. It is off by default, created/widened only in the Mac UI, and revocable locally. Saving a connected daemon grants no reverse access.
- Require `workspace.write` on the originating daemon plus this Mac-local enrollment. The daemon stamps principal, workspace, agent, and connection generation; tool arguments cannot choose their own authority. The Mac validates the enrolled daemon and provenance.
- Agents operate only their own tasks and report attention. Human Continue, takeover, and recovery have distinct authenticated control paths; an agent cannot self-approve them. A trusted daemon or unrestricted same-user process can bypass the service, so the queue is not an OS security boundary.
- Restrict v1 browser actions to task-owned tabs and HTTP(S) navigation. No extension-management, arbitrary shell, vault, or clipboard APIs. Existing arbitrary `browser_evaluate` is not automatically included in the Chrome tool surface.

## Backend qualification

agent-browser's [existing Chrome connection](https://agent-browser.dev/cdp-mode) and [sessions](https://agent-browser.dev/sessions) make it a candidate, not a proven implementation. Pin the binary version during A2 and record Chrome/1Password versions, connection mode, selected profile, and exact execution process.

Verify that connecting preserves the intended profile and extension, pins the intended tab, does not silently create another browser, and supports the observations/actions needed for the sign-in flow. Establish cancellation and drain for the actual executor, including any background process. Killing a CLI caller or timing out a CDP request does not prove dispatched browser/native work stopped. If safe drain cannot be demonstrated, block ownership transfer and revise the adapter; do not ship automatic queue progression.

Do not enable debugging or restart the user's Chrome implicitly. Document the required local setup and make profile/connection changes explicit before the live proof. A fresh profile without the user's extension/passkey setup does not satisfy A2.

## Data Model

The Mac-local host owns authoritative records; daemon copies are routing records and observations. Use the shared helper's user/session-wide ownership boundary, not separate queues per daemon or renderer.

| Record             | Fields and lifetime                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Profile enrollment | Stable desktop/profile IDs, local profile reference, permitted daemon identities, enabled flag; persist locally, never send filesystem paths or credentials as discovery data. |
| Browser task       | Opaque ID, qualified caller, selected desktop/profile, bounded purpose, owned tab IDs, queue sequence, state, revision, deadlines.                                             |
| Profile lease      | Host epoch, grant sequence, task ID, registration generation, monotonic expiry; memory only, never restore active ownership.                                                   |
| Screen reservation | Reference to the same task's shared Mac-arbiter reservation; Chrome cannot mint independent screen authority.                                                                  |
| Attention          | Task ID, attention ID, revision, reason, short instruction, safe site label, timestamps; no credentials, passkeys, authentication screenshots, or full authentication URLs.    |
| Operation receipt  | Task/epoch/operation ID and accepted/dispatched/completed/unknown result; reject reuse with different arguments.                                                               |

Persist task metadata and pre-dispatch markers atomically in the local helper journal. Keep operation arguments, typed values, cookies, tokens, and screenshots out of that journal. Transient page observations may enter the owning agent's normal transcript; disclose this at enrollment and suppress capture while the human owns control. Keep credentials in Chrome/1Password, never copy a profile to a remote workspace.

## Ownership and lifecycle

Acquire the profile/tab reservation first, then the shared Mac screen; release in reverse. Native tasks cannot acquire a Chrome profile while holding the screen. Reuse the native arbiter's limits, heartbeat, epoch, drain, and restart rules rather than defining a second screen lease implementation.

| State                                                        | Behavior                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `queued`                                                     | FIFO per profile; no browser observations or actions. Return task ID and position promptly.            |
| `waiting_screen`                                             | Profile reserved; await the shared arbiter, without touching Chrome.                                   |
| `active`                                                     | Both reservations valid; host validates epoch, grant, provenance, and target before every operation.   |
| `stopping`                                                   | Close admission, cancel queued execution, and drain admitted work before any handoff.                  |
| `human_control`                                              | Reserve profile and screen; no agent capture/input. Show Continue and Cancel with elapsed time.        |
| `recovery_required`                                          | Unknown execution; no further automation or ownership transfer until local recovery proves quiescence. |
| `completed`, `cancelled`, `expired`, `interrupted`, `failed` | Terminal; invalidate attention and lease. Release only after drain.                                    |

Route every Chrome/CDP operation, including observation, through the same serialized task operation lane. A valid lease alone does not permit parallel navigation/capture/click calls. Deduplicate identical in-flight IDs before enqueue, and revalidate profile, tab, epoch, and snapshot generation at dispatch.

Use one outstanding task per agent/profile and a bounded queue. Screen/task deadlines, one executing operation, bounded pending admission, and pre-enqueue receipt deduplication follow the native contract. A human-attention deadline must not start the next agent while the user may still be authenticating: retain the native arbiter's persisted screen-level human hold until explicitly returned. That hold survives cancellation/archive of the Chrome task, disconnect, expiry, and helper restart. Preserve the associated profile reservation while the hold remains, even if its originating task is terminal; return-control releases it without resurrecting that task.

Cancellation acknowledges stopping, not completion. Disconnect, agent archive/interruption, enrollment revocation, lease expiry, and operation timeout close admission; none prove drain. Do not replay an uncertain click or submission. After helper restart, generate a new epoch, interrupt old tasks, reject old refs/leases/Continue actions, and enter recovery for unfinished dispatch markers.

Task tabs remain bound to their profile/task. Tab closure or replacement fails the target rather than using the active tab. Finishing releases automation ownership but does not close user tabs or sign out. Only an explicit task action may close a tab created by that task; it cannot close a pre-existing user tab.

## Human authentication and UI

The agent explicitly requests attention when blocked; detection can assist but is not the sole trigger. Drain automation before publishing an actionable handoff. The card names workspace, Mac, profile label, site, and required local action. Queue updates and notifications never focus Chrome automatically.

The user completes 1Password/passkey authentication on the Mac, then chooses Continue. Validate task ID, attention ID, revision, enrollment, and both reservations; issue fresh leases/refs and observe the page before proceeding. Continue is not proof of authentication. Failed sign-in produces a new attention revision. Follow the native spec's durable Continue receipt contract: an exact previously accepted attention/revision returns its recorded result and current state without issuing another lease or clearing a later hold; an unaccepted superseded revision fails.

Show owner, queue position, connection state, and Stop/Take control locally; expose the requesting daemon's tasks and aggregate foreign queue counts remotely, not another daemon's task contents. The shared native arbiter owns emergency takeover even when the daemon is unreachable.

Persist attention before delivery. Reuse Paseo notification routing and the mobile follow-up's explicit phone policy. Current FSH Android includes Expo/Firebase push via [PR #119](https://github.com/fullstackhouse/paseo/pull/119), merged November 17; this checkout predates it. Existing delivery is accepted for this spec; see the mobile proposal for the user-observed background receipt and verification limits. A send acknowledgement never resumes a task or proves phone delivery.

## API Contracts

Proposed gate: optional `server_info.features.chromeBrowserHost`, checked once at registration/tool exposure. The capable Mac host must also implement the shared arbiter contract. Unsupported hosts show update/unavailable guidance; there is no fallback to embedded tabs. Preserve existing embedded browser behavior and parsing compatibility.

New RPCs use `.request`/`.response` pairs under the proposed prefixes below. Requests carry `requestId`; responses correlate it under `payload`. Use pure structural schemas and owned subscriptions; do not send new message kinds to unsupported peers.

| Prefix                                                        | Contract                                                                                                                                            |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser.chrome.host.register`                                | Source-owned registration with stable desktop ID, host epoch, enrolled profile descriptors, backend/version/capabilities. No secrets in discovery.  |
| `browser.chrome.task.acquire`                                 | Explicit desktop/profile IDs, purpose, client request key; return task snapshot promptly, not an MCP call held through human input.                 |
| `browser.chrome.task.get` / `browser.chrome.task.observe`     | Authorized task snapshots and monotonic revisions; observations follow release/reconnect ownership.                                                 |
| `browser.chrome.task.execute`                                 | Owned task, operation ID, bounded typed action and current tab/ref; daemon attaches provenance/lease, host returns receipt or typed failure.        |
| `browser.chrome.task.request_attention`                       | Owned task, reason/instruction; enter stopping, return attention identity, become actionable only after drain.                                      |
| `browser.chrome.task.finish` / `browser.chrome.task.cancel`   | Own-task request; return stopping or terminal snapshot.                                                                                             |
| `browser.chrome.task.continue`                                | Human-only task/attention ID plus expected revision; validate and resume once.                                                                      |
| `browser.chrome.host.dispatch` / `browser.chrome.host.cancel` | Daemon-to-host requests bound to registration, epoch, grant, task, operation; cancel response distinguishes closed admission from drained executor. |

Add provider-neutral tools through Paseo's existing catalog/MCP adapter. Reuse source-bound executor reply validation from browser host registration; a different session must not complete another host's operation. Do not overload existing browser tab IDs with desktop/profile authority. Human takeover/return uses the shared desktop contract, not another independent control API.

## Failures and verification

| Scenario                                                           | Required evidence                                                                               |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Parallel calls and duplicate in-flight IDs from one owning task    | One dispatch per ID, serialized observation/navigation/click, stale target rejected at dispatch |
| Two agents, two daemons, or two Paseo instances target one profile | One profile owner and one shared screen reservation; no overlapping actions.                    |
| Chrome passkey task competes with native input                     | Native task cannot focus/type/capture during Chrome ownership or human authentication.          |
| Host disconnects, timeout occurs, helper crashes                   | No next owner before verified drain/recovery; stale requests and replies rejected.              |
| Tab/profile/browser closes or target changes                       | Explicit target failure; no switch to active tab or alternate profile.                          |
| Takeover, failed login, duplicate Continue, attention expiry       | Human reservation maintained; fresh condition verification; one resume per revision.            |
| Enrollment revoked, forged response, another agent's task ID       | Reject at the authority/dispatch boundary and stop admitted work safely.                        |
| Notification fails or arrives late                                 | Waiting card remains authoritative; delivery never changes ownership.                           |
| Old client/new daemon or new client/old daemon                     | Existing browser works; new feature is gated without parse failures.                            |

## Phasing and Implementation Plan

1. **A2 preflight:** inventory executor, remote destination, isolated dev readiness, and shipped bridge. Completed read-only November 17: `agent-browser` absent from PATH; installed Paseo 0.15.3 has Claude/Codex; `list_hosts` returns only the Mac; worktree dependencies/build outputs exist but freshness is unverified, dev home absent and scripts stopped. App-saved remote connections were not inventoried. Remote `fsh` `90498ae` still has only the embedded adapter. A remote proof target and Mac Chrome adapter are missing.
2. **Qualify and prove one task:** prepare isolated daemon/desktop setup without restarting `6767`, select the remote test host, pin the candidate backend, and implement the minimum source-owned Chrome adapter. Before connecting a signed-in profile, restrict the proof to one admitted task and implement local Stop/Take control, a durable human hold, source/target validation, epoch rejection, and verified stop/drain; failed drain keeps the profile unavailable. These minimum safeguards precede the later production queue. Prove a remote Claude task reaches the selected real profile, pauses for user-completed 1Password authentication, and verifies success; repeat with Codex. Record versions and connection requirements without secrets. Failure revises the adapter, not the acceptance criterion.
3. **Build ownership:** implement profile queue, shared-arbiter integration, journal/epochs, receipts, bounded operations, and stop/drain recovery. Use fake delayed/noncooperative backends in existing suites before real multi-agent input. Single-task A2 evidence does not authorize claims of safe concurrency.
4. **Add human surfaces:** task/queue observation, local takeover, actionable attention, Continue/Cancel, and notification integration. Validate stale actions, access revocation, absent host, and secret-free metadata.
5. **Acceptance and rollout:** run the matrix above with real Claude/Codex remote tasks and local Chrome/native contention, targeted tests, actual-window UI/console checks, typecheck/lint/format, and CI for broad suites. Ship disabled by default after backend drain qualification. Disabling closes admission and drains; rollback retains inert recovery records and never closes the user's browser.

## A2 feasibility evidence

On November 18, both real providers passed the disposable-profile proof: Claude `claude-opus-5-5` and Codex `gpt-6-astra`, with agent-browser `0.43.0` and Google Chrome `157.0.8103.79`. Each provider ran through its own isolated, loopback Paseo daemon and the existing source-owned browser-host transport. One shared prototype adapter admitted tasks sequentially. Each agent opened the fixture, took a snapshot, clicked its button, and verified a fresh snapshot. The fixture server recorded exactly one nonce receipt per provider. Foreign source/agent requests, a competing owner, and requests after release were rejected without dispatch.

Saved desktop connections contained only this Mac. This proves separate-daemon routing on one machine, not a remote network connection. The profile was disposable and headless; this does not establish extension or passkey behavior. The proof daemons and disposable Chrome were stopped afterward; the main daemon was not restarted or reconfigured.

The experiment lives in [`chrome-proof/harness.ts`](../../packages/server/src/server/browser-tools/chrome-proof/harness.ts), with its narrowly allowed adapter beside it. It is not wired into the product. Pin agent-browser under `.dev/chrome-proof-tools`, start a separate Chrome with a disposable user-data directory and loopback debugging, then run:

```sh
PASEO_CHROME_PROOF=1 \
A2_AGENT_BROWSER_PATH="$PWD/.dev/chrome-proof-tools/node_modules/.bin/agent-browser" \
A2_CDP_ENDPOINT="<disposable Chrome CDP port>" \
A2_CLAUDE_MODEL="<available Claude model>" \
A2_CODEX_MODEL="<available Codex model>" \
npx tsx packages/server/src/server/browser-tools/chrome-proof/harness.ts
```

Each run writes local proof evidence under `.dev/chrome-proof/run-*/proof.json`. Retain the distinction between fixture receipts, agent assertions, and human authentication evidence. Never point fixture mode at a personal profile. The live variant requires its explicit opt-in, a user-wide lock, and local human controls; it allows page observation but delegates all authentication to the user. Its journal fails closed after unknown execution or a persisted human hold. These prototype controls do not implement the production screen arbiter, queue, or enrollment model.

The normal-profile run verified Claude after the user completed a fresh 1Password ceremony: the pre-handoff page was logged out and the post-Continue snapshot showed the logged-in heading at `/profile`. The following Codex connection prompted for Chrome debugging approval again and timed out before approval; the adapter retained its recovery lock. Recovery cancelled the expired Chrome prompt, stopped the identified proof executor, verified both the harness and executor had exited, then removed only that run’s lock. A Codex-only retry reached human control; the user then cancelled further Codex experiments because the Claude result was sufficient. Temporary Chrome debugging was disabled, proof tabs were closed, and the isolated executor was stopped. Codex authentication is untested. Neither a timeout nor process exit alone establishes browser drain.

For the human-login phase, use the same explicit environment variables with `PASEO_CHROME_LIVE_PROOF=1` and run [`chrome-proof/live.ts`](../../packages/server/src/server/browser-tools/chrome-proof/live.ts). Supply the loopback endpoint of the intended normal Chrome profile, not the disposable fixture profile. The script prints a local control page, opens WebAuthn.io through each provider, and pauses without further observation. The user performs registration/authentication in 1Password and explicitly returns control. A fresh post-return snapshot must show the demo’s logged-in heading at `/profile`; the password manager used is recorded as human confirmation, not inferred from the page. The control page’s Stop remains available during agent execution. Unknown execution and held-state shutdown retain the lock at `~/.cache/paseo-chrome-proof-owner`; do not remove it without checking the old executor and returning human control.

Live preflight found installed 1Password extension files, but no debugging endpoint for the normal Chrome profile. Native computer-use operations returned `cgWindowNotFound`; the only running Chrome process after fixture cleanup belonged to another headless automation profile and was left alone. No normal profile was copied, relaunched, or enabled for debugging. The next live step requires opening the intended Chrome profile and its remote-debugging connection. Until that succeeds, the prepared live harness has unit/control-test coverage only; no passkey login or resume is claimed.

## Sources and review limits

Existing evidence: [browser contract](../../public-docs/browser.md), [mobile browser placeholder](../../packages/app/src/desktop/browser/pane/index.tsx), [owned host registration](../../packages/server/src/server/session.ts), [broker](../../packages/server/src/server/browser-tools/broker.ts), [desktop handler](../../packages/app/src/desktop/browser/automation/handler.ts), [connected-host authority](../connected-hosts.md), [plugin boundaries](../plugins.md), and [protocol compatibility](../protocol-compatibility.md).

External evidence: [agent-browser existing Chrome/tab pinning](https://agent-browser.dev/cdp-mode), [sessions](https://agent-browser.dev/sessions), [1Password browser passkeys](https://support.1password.com/save-use-passkeys/), [Paseo Claude Chrome issue #8913](https://github.com/getpaseo/paseo/issues/8913), and [Claude shared browser-selection issue #88057](https://github.com/anthropics/claude-code/issues/88057). These establish component behavior and reported limitations, not an end-to-end test. The fixture evidence above does not establish live-profile authentication, production queuing, native cancellation, or phone handoff delivery.

Set `A2_PROVIDER=claude` or `A2_PROVIDER=codex` to retry one provider after explicit recovery; omit it to run both. Evidence records the requested providers. Be ready for Chrome to request debugging approval again for a new provider connection.
