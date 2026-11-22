# Mobile browser live view

## Status / TLDR

Phases 1-3 are implemented behind the off-by-default `daemon.browserLiveView` setting. Phase 4 (login request and deep link) is not.

The phone gets a live view of one Paseo browser tab hosted by the connected desktop app. Frames come from CDP `Page.startScreencast` on the desktop and travel desktop → daemon → phone as binary frames. The view is read-only until the user presses Take control. From then until control ends, agent `browser_*` calls on that tab fail with a retryable `browser_human_control`, and the phone sends taps, scrolls, keys, and autofilled text back.

Electron behavior described here was checked on Electron 44.2 on 2026-11-22. Claims marked **(unverified)** were not.

## Problem

Agents drive desktop `<webview>` tabs through `browser_*` MCP tools. When a site asks for a login, the agent stops and the human has to walk to the desktop. On mobile the browser pane only renders "unavailable" (`packages/app/src/desktop/browser/pane/index.tsx:15-33`). The human should be able to sign in from the phone, with 1Password autofill for passwords and OTP codes.

At the desktop, password and one-time-code logins already work in Paseo tabs: 1Password Universal Autofill (Cmd+\\) filled a test login form in a built-in tab (user-observed, 22 November 2026). Passkeys do not work there. This feature brings the same password and one-time-code path to the phone.

## Scope and non-goals

In scope:

- View one existing tab, on iOS and Android, over LAN or relay.
- Tap, scroll, a small key set (Enter, Tab, Backspace, Escape, arrows), and text insertion from a native `TextInput`.
- A human-control lock per tab that blocks agent browser tools.
- A "login needed" notification that opens the live view.

Non-goals:

- **Passkeys / WebAuthn.** They do not work in Paseo's Electron browser (tested). The phone cannot forward a platform authenticator either. Sites that require a passkey stay unsupported.
- Opening, closing, or navigating tabs from the phone beyond what taps do. URL bar is out.
- Web (browser) client live view. Electron already shows the real tab.
- Video codecs (H.264/WebRTC). JPEG screencast is enough for login forms.
- Multi-touch, pinch-zoom inside the page, drag, file upload, clipboard sync.

## User flow

1. The agent hits a login wall. The user opens the tab with View live in the chat (phase 4 adds a notification).
2. Frames appear. The agent can still use the tab: watching locks nothing.
3. The user presses Take control. The tab locks at once. Input is accepted once the agent's running command on that tab finished, or was cancelled after 10 seconds.
4. The user taps a field. The desktop clicks and returns the focused field's kind, its frame's committed origin, and the top-level origin. The phone shows both origins and focuses a native `TextInput` with the matching autofill hint.
5. The password manager fills the input and the user presses Send. The desktop types the value only if the origins and the field are still the ones shown, and all of it fits. A code goes over consecutive one-character boxes. Otherwise it refuses and the phone says so.
6. The user submits, completes the one-time code the same way, and presses Hand back to agent. The lock ends and the agent gets a note on its next browser call. Hand-back starts no turn.

Leaving the screen or backgrounding the app, as switching to a password manager does, stops the stream and keeps the lock. Returning resumes control.

## Design

### Protocol (`packages/protocol`)

Dotted RPCs per `docs/rpc-namespacing.md`, in `browser-automation/live-view.ts`:

| App → daemon                           | Daemon → desktop                            | Purpose                                                                       |
| -------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| `browser.live.start.request`           | `browser.host.live.start.request`           | Watch. The response's `control` says whether this viewer holds the tab        |
| `browser.live.stop.request`            | `browser.host.live.stop.request`            | Stop watching. Control survives                                               |
| `browser.live.take_control.request`    | `browser.host.live.take_control.request`    | Lock, drain or cancel the agent's running command, return focus               |
| `browser.live.send_input.request`      | `browser.host.live.send_input.request`      | `tap`, `scroll`, `key`, or `insert_text` bound to a `targetId`; returns focus |
| `browser.live.release_control.request` | `browser.host.live.release_control.request` | Hand back. The daemon adds `discardInput` on releases the user didn't ask for |
| `browser.live.frame_ack`               | `browser.host.live.frame_ack`               | One-way; releases the next frame                                              |

The desktop reports a stream or a controlled tab that went away with the one-way `browser.host.live.ended` and `browser.host.live.control_ended`.

A stream also ends while the lock goes on, as after a debugger detach, so its end is no sign that control ended. `browser.live.ended` and a failed start carry the daemon's `control.held`, and the phone drops control only on that or on `not_controller`, which only the daemon's lock decides. A request on a stream that is gone gets `stream_ended`. The desktop sends `control_ended` before `ended` when a tab closes, so that word is current.

Frames are binary, not JSON. Add a `browser_live` opcode to `packages/protocol/src/binary-frames/` next to terminal and file-transfer (`demux.ts:13-40`): `[opcode][streamId][frameSeq][metadata: deviceWidth, deviceHeight, offsetTop, pageScaleFactor, scrollOffsetX/Y, origin, documentId][jpeg bytes]`. Electron main adds `origin`, the tab's committed origin, and `documentId` when the frame arrives. A 60-quality JPEG at 1080px wide is ~60-150 KB, which binary chunking and relay `binaryCiphertext` already carry (`docs/protocol-compatibility.md` "Binary chunking"; `SECURITY.md` "How it works" step 4).

`browser_human_control` is not in the wire enum, because older peers reject responses with codes they don't know. The daemon makes it for MCP callers only. The desktop and live view responses use `browser_denied`, which the daemon translates for a held tab. Control RPCs have their own error shape with an open string `code`.

Desktop hosts register `liveView` and `liveViewInput`. The daemon advertises `features.browserLiveView` and `features.browserLiveViewInput` while the setting is on.

### Daemon (`packages/server`)

- `BrowserToolsBroker` routes streams, control, and input to the host that owns the tab, and relays frames without decoding them. The phone's ack releases the next frame, so one is in flight end to end. The desktop keeps the newest frame that arrived meanwhile: a page that stops painting never sends another. With two frames unacked Chromium drops what it paints next, so the desktop restarts the screencast once after catching up; `invalidate()` produces no frame.
- `BrowserHumanControl` holds one controller per tab, keyed by principal and app install so control survives a new session. Only the controller can send input, hand back, or start a stream on a held tab.
- While held, the broker refuses every command that names the tab, reads included, before host selection. `browser_list_tabs` keeps the entry with `humanControl: true` and withholds its URL and title.
- All `browser.live.*` and `browser.host.live.*` messages need `workspace.write`. A read-only principal can't watch either: frames show authenticated pages.
- The hand-back note waits while the tab is held: a granted take makes it stale, a failed one leaves it true.
- The hand-back note says which tab and what ended. It goes into the chat and into the agent's next browser result (`userNotes` and the last text part), never into a prompt.

How control ends:

| Event                                          | Result                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Hand back                                      | Secret fields live view filled are cleared; the page stays; history is cleared if anything was typed |
| Phone has no stream for 5 minutes              | Discard, then release                                                                                |
| Setting switched off                           | Streams end at once; discard, then release                                                           |
| Daemon restart, or desktop lost its connection | The daemon has no lock left. The desktop stays locked, discards, then releases by itself             |
| Tab closed, or its window reloaded             | The document is gone; control ends                                                                   |
| A discard fails                                | The lock stays and is retried every 30 seconds                                                       |

### Desktop (`packages/desktop`)

Electron main enforces the lock too (`features/browser-automation/human-control.ts`). It alone knows when an agent command really finished, and every daemon connected to the desktop goes through it.

- **Taking over a running command.** After 10 seconds the command is cancelled: the agent is refused, the command can make no further call on the tab, and late results are dropped (`agent-commands.ts`). If its script is still in the page, only a new document is sure to end it: main interrupts it, replaces the document as a discard does, and grants control after that. This costs unsaved page state and history. A script that still waits for the page to load is never started. Electron would run it in the next document.
- **Frames and documents.** A frame keeps the origin and document it arrived with. A main-frame commit drops the waiting frame, and a frame whose capture time predates the commit is dropped too. After a commit Chromium sends nothing until the new document's first paint. Taps and scrolls carry the `documentId` of the image on screen and are refused once it changed. An iframe's navigation doesn't change it: text is still bound to that frame's origin.

- **Focus and origins.** `webContents.focusedFrame` names the frame and main reads its committed origin and the top frame's. Page script supplies neither. The guest preload describes the focused `input` or `textarea` in that frame and mints a `targetId` bound to the element and its type, name, id and autocomplete.
- **Text.** Main checks both origins and the focused frame, then sends the value to that one frame. The guest preload checks the field and calls `webFrame.insertText` on its local root in the same synchronous step, with a guard against page handlers that move focus mid-commit.
  - Don't use `webContents.insertText`. It runs `webFrame.insertText` in the main frame, whose widget has no input controller while a cross-origin iframe has focus: the renderer crashed 3 of 3 times (exit code 11) and the promise never settled.
  - Don't use CDP `Input.insertText`. It commits into whichever element has focus in the Paseo window.
  - An unanswered insert fails closed: error on the phone, lock kept, no resend. The request carries a deadline, so a late arrival types nothing.
- **The preload** is the keyboard preload every guest frame already runs. It adds one IPC listener and sets nothing up until main sends to it, which happens only during control. It exposes nothing to page script.
- **Tap and scroll.** Screencast coordinates are device-independent pixels; divide by the zoom factor for CDP. A tab that isn't on screen is parked at 1x1, so root-session mouse input never hit-tests into its out-of-process iframes. Route through the iframe's auto-attached CDP session (`frame-sessions.ts`), with the point mapped back through all four corners of the iframe's quad, because CSS transforms scale, rotate and skew it. `DOM.getNodeForLocation` takes document coordinates, while quads and input take viewport coordinates.
- **Keys** use the isolated `sendInputEvent`. Enter needs a `char` event to submit a form. Keys don't reach another process's iframe, so they are refused there and the user taps the button.
- **Discard.** Setting a value keeps the undo stack: `execCommand("undo")` and `"redo"` brought back cleared usernames and passwords. A release the user didn't ask for replaces each still-open document live view typed into (about:blank, then a GET of the URL) and clears history, which also drops saved form state. It never calls `reload()`, which submits a POST again. Hand-back only clears secrets this control typed, not what an agent typed since an earlier one, and rebuilds those inputs' inner editors by toggling their type, which removes their undo steps.
- **Dialogs** are answered from the moment Take control is pressed, because one blocks all further input: `alert` and `beforeunload` accepted, `confirm` and `prompt` dismissed. One that is already open is dismissed at take, and also at stream start: in the main frame it holds up `Page.enable` and the screencast, so the tab couldn't be watched or taken. CDP can answer only dialogs that opened after `Page.enable`, and it leaves Electron's message box up, so main keeps the answer from Electron's internal `-run-dialog` event (`page-dialogs.ts`). Re-check it on Electron upgrades with the e2e below.
- Read `webContents.debugger` before the tab is destroyed. The getter throws afterwards, and a throw in the `destroyed` listener blocks Electron main behind an error dialog.

### App (`packages/app`)

- Native pane: replace the "unavailable" body in `pane/index.tsx` with a live view when `server_info.features.browserLiveView` is true; otherwise keep the current text plus "Update your host". `index.web.tsx` and `index.electron.tsx` are unchanged.
- `LiveViewSurface`: an `Image` fed from the latest frame as a base64 data URI in `expo-image`, which swaps without a flash. While controlling, tap and pan gestures map to screen coordinates and send input. Ack each frame after it renders.
- Stream only while the route is focused and `AppState` is `active`. Stop on blur; restart on focus.
- `SecretTextInput`: a native `TextInput` shown for a focused field, with hints from its kind: `password`, `one-time-code`, `username`, `email`. A native input gets no domain matching from a password manager, so the origin it types into, and the top-level origin when that differs, sit right above it.
- Text is sent with Send, then cleared. It is in no store, form model, or draft. The input is keyed by target, so text can't follow focus to another field.
- Origin, document and coordinates come from the image on screen, not from a frame that is still decoding.
- The binding changes only with the user's own input, never by itself: a fill can arrive long after the field was shown.
- The control panel and its input stay mounted while the stream is stopped.

### Notifications (phase 4)

Add a `browser_live` payload to `notification-open` (`docs/notifications.md`; `packages/app/src/notification-open/model.ts`): `{ serverId, agentId, browserId, reason: "browser_login" }`. Open it with `navigateToAgent` and then the browser tab for `browserId`, so a moved agent still resolves. Push eligibility stays a daemon concern.

## Security and secrets

- Authority: `workspace.write`, same as agent browser tools and terminals.
- `insert_text.text` is a secret:
  - No layer logs it. The daemon's only inbound payload trace was `payloadBytes`, which would leak a password's length, so input messages omit it. Validation errors don't quote values. Client traces carry types and ids only.
  - The desktop log's renderer-console spy wrote every guest page's console to `main.log`. Tabs live view typed into are left out, and `browser_logs` collects nothing while a tab is held.
  - It is in no timeline, note, error, metric, or persisted state. Desktop and app start no crash reporter.
- Frames are in memory only. Relay traffic stays E2E encrypted (`SECURITY.md`).
- Agents keep the session after hand-back. The UI says so, and that unsubmitted input is discarded after 5 minutes away.

A per-tab lock can't cover these:

- The browser profile is shared. An agent can open the same site in another tab and use the new cookies while the user still controls this one. A same-origin tab can also reach this one through `window.opener`, `BroadcastChannel`, or storage.
- Scripts an agent put in the page before Take control keep running and see what is typed.
- What the page copies itself survives a discard: storage, cookies, its server, the URL of a GET form.
- Hand-back leaves the page open. Text that wasn't secret, and any copy the page made, stays readable.
- Popups open as separate windows or tabs, with no lock and no view on the phone.
- Local processes with the daemon's owner credential, the desktop's debugging port, or DevTools bypass browser tools.
- Another daemon on the same desktop is refused by Electron main for page commands. Resize and close are handled in the renderer and only by this daemon's lock.
- Iframes that navigate under an unchanged top document still accept a tap aimed at their old content.
- The person at the desktop can still use the tab (open question 4).

## Compatibility

- All new message types and fields are additive. Old apps never send `browser.live.*`; old daemons reject them as unknown, and the app does not send them without `features.browserLiveView`.
- Old desktop hosts register without `liveView`; the daemon returns `browser_unsupported` on start ("Update Paseo desktop").
- A phone that can control, with a watch-only daemon, sees "Update Paseo on this host to take control". With a watch-only desktop, the start response has no `control` and the phone names the desktop. Neither sends a control RPC.
- New binary opcode is only sent to sessions that opened a stream, so old clients never see it.
- Wire schemas stay pure: no `.transform()` on the new schemas (`docs/protocol-validation.md`).

## Phases

1. **Protocol, daemon, desktop streaming.** Schemas, binary opcode, broker registry, desktop screencast with ack flow control, `features.browserLiveView`, permissions. No UI. Verified with the CLI or an SDK test client.
2. **Mobile view-only.** Native pane, visibility-gated streaming, frame acks, update-host message.
3. **Input and human control.** Explicit Take control, tap/scroll/key/`insert_text`, origin-bound text, `SecretTextInput`, the lock in daemon and desktop, `browser_human_control`, hand-back note.
4. **Login request and deep link.** `browser_request_human` tool, attention notification, `notification-open` route.

## Test plan

- Schemas, binary codec, and a secret in rejected input: `messages.browser-automation.test.ts`, `binary-frames/browser-live.test.ts`.
- Lock, lifecycle table, notes: `browser-tools/broker.test.ts`.
- A sentinel through phone client, WebSocket, session, broker, and host, checked against logs, traces, and replies: `websocket-server.browser-tools.test.ts`.
- Binding, coordinates, documents, cancelled commands, dialogs, discard, fail-closed inserts: `browser-automation/ipc.test.ts`. The preload: `browser-keyboard/guest-preload.test.ts`.
- Real Electron, for what fakes can't reproduce (cross-origin and transformed iframe input, code boxes, never-settling scripts, dialogs, frames around a commit, undo after discard): `e2e/browser-live-input.electron.mjs`, run by `test:e2e:browser-tabs`.
- Manual QA (`docs/qa.md`): iOS and Android, LAN and relay, sign in with password and one-time code from a password manager **(unverified: 1Password isn't available in simulators)**, background mid-fill, then grep daemon and desktop logs for the dummy values.

## Open questions

1. Reject or pause agent calls while the human holds the tab? Decided: reject with a retryable `browser_human_control`.
2. Lock lifetime when the phone disconnects without hand-back? Decided: 5 minutes, then discard and release.
3. Should the agent be woken on hand-back? Decided: no. It gets a note on its next browser call.
4. Should a desktop user's local clicks in the same tab also count as human control? Not covered here.
5. Default caps: 5 fps, quality 60, `maxWidth` = phone pixel width capped at 1280. Measure over relay before fixing them.
6. Does a hidden guest keep painting for minutes? Decided in phase 1: a frame subscription and unthrottled window while streaming (`frame-production.ts`).
