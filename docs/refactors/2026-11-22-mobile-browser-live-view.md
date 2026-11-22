# Mobile browser live view

## Status / TLDR

Draft spec, not implemented. The phone gets a live view of one Paseo browser tab hosted by the connected desktop app. Frames come from CDP `Page.startScreencast` on the desktop, travel desktop → daemon → phone as binary frames, and the phone sends taps, scrolls, keys, and autofilled text back. While the human holds the view, agent `browser_*` calls on that tab fail with a retryable error until the human hands back.

Line references were checked on branch `use-paseo-builtin-browser-tabs` on 2026-11-22. Claims marked **(unverified)** were not traced in code.

## Problem

Agents drive desktop `<webview>` tabs through `browser_*` MCP tools. When a site asks for a login, the agent stops and the human has to walk to the desktop. On mobile the browser pane only renders "unavailable" (`packages/app/src/desktop/browser/pane/index.tsx:15-33`). The human should be able to sign in from the phone, with 1Password autofill for passwords and OTP codes.

## Scope and non-goals

In scope:

- View one existing tab, on iOS and Android, over LAN or relay.
- Tap, scroll, a small key set (Enter, Tab, Backspace, Escape, arrows), and text insertion from a native `TextInput`.
- A human-control lock per tab that blocks agent browser tools.
- A "login needed" notification that opens the live view.

Non-goals:

- **Passkeys / WebAuthn.** They do not work in Paseo's Electron browser (tested by Jacek). The phone cannot forward a platform authenticator either. Sites that require a passkey stay unsupported.
- Opening, closing, or navigating tabs from the phone beyond what taps do. URL bar is out.
- Web (browser) client live view. Electron already shows the real tab.
- Video codecs (H.264/WebRTC). JPEG screencast is enough for login forms.
- Multi-touch, pinch-zoom inside the page, drag, file upload, clipboard sync.

## User flow

1. Agent hits a login wall and calls `browser_request_human` with `browserId` and a short reason. The daemon sends an attention notification to the user's devices.
2. User taps the notification. The app opens the live view route for that host, agent, and tab.
3. The app sends `browser.live.start.request`. The daemon takes the human-control lock and asks the desktop to start the screencast. Frames appear.
4. User taps the email field. The desktop clicks, reads the focused element's `type` and `autocomplete`, and returns them. The phone focuses a native `TextInput` with the matching autofill hint; 1Password offers the credential.
5. The phone sends the value as `insert_text`. The desktop commits it into the focused field. The user taps "Sign in", completes OTP the same way.
6. User taps "Hand back to agent". The daemon stops the screencast, releases the lock, and appends a short "human finished in tab X" note to the agent (text only, no values). The agent re-snapshots.

Leaving the screen, backgrounding the app, or disconnecting also stops the stream. The lock stays until hand-back or a lock timeout (open question).

## Design

### Protocol (`packages/protocol`)

New RPCs, dotted per `docs/rpc-namespacing.md`, all fields beyond the required ids optional:

| Message                                    | Direction        | Fields                                                                                                                                                                                       |
| ------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser.live.start.request` / `.response` | app → daemon     | `requestId`, `browserId`, `maxFps?`, `jpegQuality?`, `maxWidth?`; response `streamId`, `viewport {width,height}`, `error`                                                                    |
| `browser.live.stop.request` / `.response`  | app → daemon     | `requestId`, `streamId`, `handBack?: boolean`                                                                                                                                                |
| `browser.live.input.request` / `.response` | app → daemon     | `requestId`, `streamId`, `input`: discriminated union `tap {x,y}` / `scroll {x,y,deltaX,deltaY}` / `key {key}` / `insert_text {text}`; response `focus? {inputType, autocomplete, editable}` |
| `browser.live.frame_ack.request`           | app → daemon     | `streamId`, `frameSeq`; no response (call out next to the schema)                                                                                                                            |
| `browser.host.live.*`                      | daemon → desktop | same shapes, forwarded to the registered browser host                                                                                                                                        |

Frames are binary, not JSON. Add a `browser_live` opcode to `packages/protocol/src/binary-frames/` next to terminal and file-transfer (`demux.ts:13-40`): `[opcode][streamId][frameSeq][metadata: deviceWidth, deviceHeight, offsetTop, pageScaleFactor, scrollOffsetX/Y][jpeg bytes]`. A 60-quality JPEG at 1080px wide is ~60-150 KB, which binary chunking and relay `binaryCiphertext` already carry (`docs/protocol-compatibility.md` "Binary chunking"; `SECURITY.md` "How it works" step 4).

Error codes: add `browser_human_control` to `BrowserAutomationErrorCodeSchema` (`packages/protocol/src/browser-automation/rpc-schemas.ts:3-14`). The daemon generates it toward MCP tools only; confirm no old peer parses it **(unverified)**.

Desktop host advertises support with an optional `liveView: true` on `browser.host.register.request` (`packages/protocol/src/messages.ts:3423-3428`). The daemon advertises `server_info.features.browserLiveView` (`messages.ts:3843`), tagged `// COMPAT(browserLiveView)`.

### Daemon (`packages/server`)

- `BrowserToolsBroker` (`packages/server/src/server/browser-tools/broker.ts:48`) gains a `LiveViewRegistry`: `browserId → { streamId, ownerSessionId, hostClientId, startedAt }`. It routes start/stop/input to the host that owns the tab via the existing affinity map (`broker.ts:53`, `selectHostForCommand` at `:140`).
- Lock check at the top of `execute` (`broker.ts:113`): a command whose `browserId` is held by a human returns `browser_human_control`, `retryable: true`, message "The user is controlling this tab. Wait for hand-back, then call browser_snapshot." `list_tabs` stays allowed and reports `humanControl: true` per tab.
- Session wiring next to `registerBrowserHost` (`packages/server/src/server/session.ts:2407`). Binary frames from the desktop session are relayed to the owner session without decoding the JPEG. Inbound frame acks follow the same path back.
- Flow control: the desktop sends `Page.screencastFrameAck` only after the phone acks that frame, so at most one frame is in flight end to end. That caps bandwidth on slow relays without extra timers.
- On owner disconnect: stop the screencast, keep the lock (see open questions). On host disconnect: drop the stream and lock, send `.stop` with an error to the phone.
- New MCP tool `browser_request_human` in `browser-tools/tools.ts`, gated on a connected host with `liveView`. It emits an attention notification (see Notifications below) and returns immediately.
- Permissions: classify every `browser.live.*` RPC as `workspace.write` in `packages/server/src/server/authorization/operation-permissions.ts`, matching `browser.automation.execute.request` (`:290`). A viewer principal (read-only) must not open the live view: frames show authenticated pages.

### Desktop (`packages/desktop`)

- Live view lives in `packages/desktop/src/features/browser-automation/` beside `ipc.ts`. It reuses the per-tab `webContents.debugger` attachment (`ipc.ts:152-155`) and must share the tab's `CdpSessionQueue` (`cdp-session-queue.ts`) for input commands so they never interleave with a stray agent command.
- Start: `Page.startScreencast { format: "jpeg", quality, maxWidth, maxHeight, everyNthFrame }`. Listen for `Page.screencastFrame` on the existing `debugger.on("message")` listener pattern (`ipc.ts:293`). Background tabs may not paint; wrap the stream in the existing `withFrameProduction` (`service.ts:39`, `ipc.ts:137`) **(unverified that it covers a long-running stream)**.
- Tap: map phone coordinates to CSS pixels with frame metadata (`x / imageWidth * deviceWidth`, `y / imageHeight * deviceHeight + offsetTop`), then `dispatchTrustedClick` (`trusted-input.ts:38`). After the click, read `document.activeElement` `type`, `autocomplete`, `isContentEditable` and return them as `focus`.
- Scroll: `Input.dispatchMouseEvent { type: "mouseWheel" }` at the mapped point.
- Keys: reuse the isolated `sendInputEvent` path (`service.ts:40`).
- Text: use `contents.insertText` (`ipc.ts:147`), **not** CDP `Input.insertText`. `service.ts:41-42` documents that CDP commits into whichever element has focus in the Paseo window.
- The Electron renderer forwards `browser.host.live.*` the same way `packages/app/src/desktop/browser/automation/handler.ts:47-72` forwards `browser.automation.execute.request` over the `paseo:browser:execute-automation-command` IPC (`ipc.ts:454`). New IPC channels: `paseo:browser:live-start`, `-stop`, `-input`, plus a frame event channel to the renderer.

### App (`packages/app`)

- Native pane: replace the "unavailable" body in `pane/index.tsx` with a live view when `server_info.features.browserLiveView` is true; otherwise keep the current text plus "Update your host". `index.web.tsx` and `index.electron.tsx` are unchanged.
- `LiveViewSurface`: an `Image` fed from the latest frame (decode JPEG bytes to a base64 data URI, or an `expo-image` source; pick whichever avoids flicker at 5 fps). Tap and pan gestures map to image coordinates and send `input`. Ack each frame after it renders.
- Stream only while the route is focused and `AppState` is `active`. Stop on blur; restart on focus.
- `SecretTextInput`: a native `TextInput` shown above the keyboard when `focus.editable` is true. Hints from `focus`:
  - `type=password` or `autocomplete=current-password|new-password` → iOS `textContentType="password"`, Android `autoComplete="password"`, `secureTextEntry`.
  - `autocomplete=one-time-code` or numeric short field → iOS `oneTimeCode`, Android `sms-otp`.
  - `autocomplete=username|email` or `type=email` → `username` / `emailAddress`.
  - Otherwise plain text.
    Send on submit or on autofill change, then clear local state. Do not bind the value to any store, form model, or persisted draft.
- Header shows "You are controlling this tab" and a "Hand back to agent" button.

### Notifications

Add a `browser_live` payload to `notification-open` (`docs/notifications.md`; `packages/app/src/notification-open/model.ts`): `{ serverId, agentId, browserId, reason: "browser_login" }`. Open it with `navigateToAgent` and then the browser tab for `browserId`, so a moved agent still resolves. Push eligibility stays a daemon concern.

## Security and secrets

- Authority: `workspace.write`, same as agent browser tools and terminals. Anyone who can type into a terminal can already drive the tab.
- `insert_text.text` is a secret:
  - Never logged at any layer. Daemon, desktop main, and renderer log only `{ streamId, inputKind }`. Check whether the daemon logs inbound message bodies anywhere (debug or trace level) and redact `browser.live.input.request` there **(unverified)**.
  - Not persisted: not in agent timelines, not in `daemon.log`, not in app storage or crash reports.
  - The hand-back note to the agent says which tab and that input happened, never values or field names that reveal them.
- Frames show authenticated pages. Keep them in memory only; no disk cache on phone or daemon. Relay traffic stays E2E encrypted (`SECURITY.md` "Relay threat model").
- Only one live viewer per tab. A second `start` from another session fails with `browser_human_control` unless it comes from the lock owner.
- Agents keep the session cookies after hand-back. That is the point of the feature; state it in the UI ("The agent can use this login").

## Compatibility

- All new message types and fields are additive. Old apps never send `browser.live.*`; old daemons reject them as unknown, and the app does not send them without `features.browserLiveView`.
- Old desktop hosts register without `liveView`; the daemon returns `browser_unsupported` on start ("Update Paseo desktop").
- New binary opcode is only sent to sessions that opened a stream, so old clients never see it.
- Wire schemas stay pure: no `.transform()` on the new schemas (`docs/protocol-validation.md`).

## Phases

1. **Protocol, daemon, desktop streaming.** Schemas, binary opcode, broker registry, desktop screencast with ack flow control, `features.browserLiveView`, permissions. No UI. Verified with the CLI or an SDK test client.
2. **Mobile view-only.** Native pane, visibility-gated streaming, frame acks, update-host message.
3. **Input and human control.** Tap/scroll/key/`insert_text`, focus hints, `SecretTextInput`, broker lock and `browser_human_control`, hand-back note to the agent.
4. **Login request and deep link.** `browser_request_human` tool, attention notification, `notification-open` route.

## Test plan

- `rpc-schemas.test.ts`: new schemas, input union, old messages still parse.
- Binary codec test beside `binary-frames/terminal.test.ts`: round-trip metadata and payload.
- `broker.test.ts`: lock blocks `click`/`type`/`snapshot` on the held tab only; `list_tabs` reports it; hand-back and host disconnect release it; second viewer rejected.
- `ipc.test.ts`: fake debugger receives `Page.startScreencast`; ack forwarded only after phone ack; coordinate mapping with `offsetTop` and scale; `insertText` goes to `contents.insertText`, not CDP.
- Secret test: drive an `insert_text` through session and desktop handler with a spy logger; assert the value appears in no log call.
- Manual QA (`docs/qa.md`): iOS and Android, LAN and relay, sign into a real site with 1Password password + TOTP autofill; background mid-stream; kill relay; agent calls a browser tool during control and gets the retryable error.

## Open questions

1. Reject or pause agent calls while the human holds the tab? Recommendation: reject with retryable `browser_human_control`. Pausing holds MCP calls up to the tool timeout and hides state from the agent.
2. Lock lifetime when the phone disconnects without hand-back: release immediately, after N minutes, or never until hand-back?
3. Should the agent be woken (prompted) on hand-back, or only see the note on its next tool call?
4. Should a desktop user's local clicks in the same tab also count as human control? Not covered here.
5. Default caps: 5 fps, quality 60, `maxWidth` = phone pixel width capped at 1280. Measure over relay before fixing them.
6. Does `withFrameProduction` keep a hidden guest painting for minutes, or does the desktop need to bring the tab forward while streaming?
