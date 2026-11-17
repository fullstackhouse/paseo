# Mobile attention delivery for browser handoffs

Status: proposed design. Scope approved. Source verification complete; real-phone verification blocked by no connected device. No implementation or push test performed.

## Scope

Request a phone notification for a human handoff even when a desktop client is present. Reuse shipped Expo/Firebase delivery and existing notification-open routing. Browser ownership and authentication belong to the [Chrome host proposal](2026-11-08-chrome-browser-host.md); native control belongs to the [desktop proposal](2026-11-17-native-desktop-control.md). This document owns notification targeting and acknowledgement, not either executor.

Push is best-effort. This feature must not promise that the phone displayed a notification, that the user read it, or that a passkey ceremony completed.

## Evidence

Inspected remote `fsh` at `90498ae764b366af27a4ddabde151ec9210d9214` on November 17. This checkout, `fd8411d` from November 8, predates these Android changes.

| Finding                                                                    | Evidence                                                                                                                                                                                                                                                                                                | Verification                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| FSH Android includes Expo notifications and its own Firebase configuration | [PR #119](https://github.com/fullstackhouse/paseo/pull/119), merged November 17; [build workflow](https://github.com/fullstackhouse/paseo/blob/90498ae764b366af27a4ddabde151ec9210d9214/.github/workflows/fsh-android.yml)                                                                              | Source and merged PR checked; daemon transport unchanged                                     |
| A built APK includes the change                                            | [Stable Android release](https://github.com/fullstackhouse/paseo/releases/tag/fsh-android-latest): 0.15.3, commit `90498ae`, asset updated November 17 at 18:33 UTC                                                                                                                                     | Release metadata checked; installed phone version unknown                                    |
| Desktop presence suppresses phone push                                     | [Attention policy](https://github.com/fullstackhouse/paseo/blob/90498ae764b366af27a4ddabde151ec9210d9214/packages/server/src/server/agent-attention-policy.ts): activity within 180 seconds selects one client; viewing the target can suppress notification entirely                                   | Static inspection, not live routing proof                                                    |
| Plugin sends use that same presence policy                                 | [Plugin delivery](https://github.com/fullstackhouse/paseo/blob/90498ae764b366af27a4ddabde151ec9210d9214/packages/server/src/server/websocket-server.ts#L3213)                                                                                                                                           | Static inspection                                                                            |
| Native warm/cold tap handling already exists                               | [Native source](https://github.com/fullstackhouse/paseo/blob/90498ae764b366af27a4ddabde151ec9210d9214/packages/app/src/notification-open/source.native.ts), [router](https://github.com/fullstackhouse/paseo/blob/90498ae764b366af27a4ddabde151ec9210d9214/packages/app/src/notification-open/model.ts) | Static inspection; waits for navigation readiness, deduplicates taps, clears launch response |

The old claim that the FSH Android build has no push support is obsolete. PR #119 explicitly leaves actual phone delivery unverified; its successful build does not close that test.

Device check: `adb devices -l` returned no devices. `xcrun xctrace list devices` could not run because `xctrace` is unavailable. No phone was installed, restarted, notified, or inspected; no token or credential was read.

## Delivery and acknowledgement

### Delivery policy

Add an explicit, capability-gated delivery option for task attention: normal presence routing or phone push alongside normal routing. Human handoffs use the latter when the user enables phone alerts for them. Existing agent completion notifications retain their current behavior.

Phone targeting means the daemon's registered mobile push subscriptions, subject to notification permission and user mute settings. It does not bypass OS Do Not Disturb or choose a particular phone. Respect existing per-plugin mute, deduplication, and rate limits. A disabled or missing subscription leaves the task visibly waiting; do not silently report that the phone was notified.

Expose this as a daemon-owned delivery decision reusable by plugin and core task senders. Do not duplicate an Expo sender in a browser plugin or change global presence rules. Final RPC field and feature names must follow [protocol compatibility](../protocol-compatibility.md) and [RPC naming](../rpc-namespacing.md). An older host must show that phone escalation is unavailable instead of claiming the requested guarantee.

Persist the pending attention record before attempting delivery. A structured `attentionRef` contains `{ executionHostId, taskId, attentionId, revision }`; the daemon stamps the owning server and sender identity. Resolve that reference against the registered executor's current waiting state and authorized source before a send. Plugin screen params are navigation hints only and cannot create or authorize attention. An offline executor leaves the request pending/unverified rather than trusting cached screen params. Core executors publish through this same dispatch entry point; plugins can request delivery only for attention registered to their runtime. Send at most one automatic alert per attention revision. Reconnect and duplicate task events must not create additional automatic alerts. For automatic sends, derive the attempt identity as `auto` within the fully qualified attention key. The store performs serialized compare-and-insert of the pending attempt before calling Expo, so simultaneous events cannot each send. A pending attempt found after restart has unknown outcome and is not automatically replayed; the user can request resend. This at-most-once attempt policy can lose an alert on a crash, so the task card remains the source of truth. A user-requested resend uses a separate attempt identifier and the same attention revision, subject to throttling. After an ambiguous send failure, preserve the waiting card and show uncertainty; do not claim delivery or blindly resend on every reconnect.

### Task identity and explicit resume

The executor owns authoritative task state. Share the following identity across both control proposals: owning daemon, execution host, task ID, attention ID, and monotonically increasing attention revision. Increment the revision for each new human request and when invalidating an existing request. A second login attempt in the same task therefore cannot consume the first attempt's Continue.

Use the existing plugin-screen target and string params to carry task ID and attention revision when the task belongs to a plugin. On tap, open the task's attention card and fetch current state from its owning daemon. If the host is unavailable, retain the target for navigation retry and show that state cannot be checked. Do not offer an actionable cached Continue.

Keep three events distinct:

1. **Send attempted:** the notification service accepted or rejected an attempt. Neither outcome proves the phone displayed it. Record the actual transport result available, without inventing a read receipt.
2. **Viewed:** the user opened the current attention card. This can acknowledge the UI request but never resumes automation. Clearing Expo's launch response acknowledges native navigation only.
3. **Continue:** the user explicitly submits the task ID and expected revision to the owning executor. It validates the caller, current paused state, revision, and resource ownership before resuming. Persist the accepted outcome keyed by caller, task, attention ID, and expected revision. An exact retry after a lost response returns that receipt and current task state without another resume or clearing a later human hold; an unaccepted superseded revision fails. A saved receipt never restores an active lease after restart.

Cancellation or task completion invalidates outstanding Continue actions. Old notifications may remain in the phone's notification center; their taps must show current resolved or superseded state. After Continue, the executor verifies the requested condition, such as successful sign-in. Failure creates a new attention revision; notification delivery never proves authentication.

Keep notification content minimal: requesting workspace, selected host, and a short reason. Store no password, passkey material, full authentication URL, or authentication screenshot in push data. The phone card explains when the action must be completed on the Mac. This feature provides neither remote Touch ID nor remote screen control.

## Implementation boundary

Extend the existing daemon notification policy and plugin notification contract only as needed for explicit phone targeting. Reuse the current native listener, cold-start navigation gates, and plugin-screen routing. No replacement push infrastructure or new native control implementation is part of this work.

Add policy coverage to existing attention-policy and plugin-notification suites. Add task/revision coverage to the executor's existing tests and tap parsing coverage to notification-open tests. Root-level typecheck, lint, and formatting remain required; run targeted test files rather than the full local suite.

## Verification

The following is outstanding, not a record of passed tests. Begin with an isolated test daemon and a disposable handoff task. Confirm the installed APK version and notification permission on a connected physical phone. Obtain a normal Expo subscription through the app; never print its token. Do not treat `adb force-stop` as an ordinary cold start: Android force-stop can prevent delivery until the app is opened again.

| Scenario                                                                           | Expected result                                                                         | Proof required                                                  |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Phone backgrounded, no present desktop                                             | One real push appears; tap opens the current waiting task                               | Timestamped daemon attempt and observed device notification/tap |
| App process absent, package not force-stopped                                      | Tap starts app, waits for host/navigation readiness, opens the task once                | Physical cold-start recording and console capture               |
| Desktop recently active or viewing requesting agent; phone backgrounded            | Default policy remains quiet on phone; explicit handoff policy requests phone push      | Paired control and treatment with the same presence setup       |
| Phone foregrounded                                                                 | Waiting card remains usable; preserve existing native foreground presentation policy    | Observed card and notification-center behavior                  |
| Duplicate tap, Android Back then launcher reopen                                   | No duplicate navigation or resume                                                       | Observed routing plus one executor transition                   |
| Task cancelled/completed, or attention revision replaced                           | Old tap opens current state; stale Continue rejected                                    | Executor state and visible resolved/superseded card             |
| Successful Continue response lost, then retried                                    | Recorded result and current state returned; no second lease grant or cleared later hold | Executor receipt and one state transition                       |
| Two devices submit Continue                                                        | Exactly one state transition; second response reports current result                    | Executor event evidence                                         |
| Offline host, disabled permission, missing subscription, muted plugin, failed send | Waiting task remains visible; no false delivery/resume claim                            | Observed error/unavailable state and transport outcome          |

Follow [native notification QA](../notifications.md#startup-and-verification) for payload shape, replay, and startup checks. Test a real Expo/FCM delivery for Android; synthetic navigation events only prove routing. iOS validation needs a separately configured signed build and device; Android evidence does not prove APNs delivery.

The device blocker leaves background and cold-start delivery unproved. Once a physical phone is connected and a safe test build/task is ready, run this matrix before calling phone handoff delivery complete.

## Phasing

1. Establish the current release's physical-phone baseline; static policy findings do not replace this.
2. Add explicit phone targeting and durable send-attempt accounting behind capability negotiation.
3. Verify real handoff taps and resume against the owning Chrome/native executor once available.

## Implementation Plan

1. Record installed app/daemon versions, permissions, and the existing default-policy baseline on a physical device. Exercise background, cold-start, and desktop-present cases without printing push tokens.
2. Propose optional `server_info.features.attentionPhonePush` and optional `delivery: "presence" | "presence_and_phone"` plus optional structured `attentionRef` on the existing plugin notification request; omission preserves current behavior. Require a valid attention reference for `presence_and_phone`; verify it through the executor-owned dispatch entry point described above. Gate the option once in the SDK/client. Core task senders use the same daemon policy. Preserve older message parsing and existing notification fields.
3. Store a bounded send-attempt record keyed by `(source, taskId, attentionId, revision, attemptId)` before delivery. Use serialized compare-and-insert, deterministic `auto` attempt identity, and a distinct validated manual-resend ID. Record pending/attempted/accepted/failed/unknown, with no receipt claim beyond the actual transport result. Use the daemon's existing atomic store conventions. Persist deduplication across restart; prune terminal-task attempt records after seven days. Enforce authorization and existing mute/rate limits on resend.
4. Add the handoff-alert preference to existing notification settings, default off until the user enables it. A durable task card remains available with either preference. Test presence and phone routing independently in existing attention-policy suites.
5. Reuse notification-open targets and current-state loading for the card. Test duplicate taps, offline hosts, superseded attention, two-device Continue, and lost response/retry against the executor contract.
6. Run the physical-device matrix above using an isolated daemon and a real executor handoff. Keep current transport-only baseline results separate from future-policy treatment results. Run targeted tests, typecheck, lint, and formatting; use existing CI for broad coverage.

## Risks and review limits

Explicit phone targeting increases interruption frequency; opt-in, existing mute controls, one automatic attempt per revision, and bounded resend prevent a new global notification default. A corrupt or unavailable attempt store must leave attention waiting and report send uncertainty, not silently regenerate alerts. Rollback removes the new option while preserving default routing and pending task state.

Source and document review support the proposed delta. Neither the new delivery option nor the future task senders exist in this checkout. Real-phone verification of both current delivery and the proposed treatment remains outstanding; no delivery guarantee is inferred from a successful build or Expo acceptance.

Architectural review required explicit executor-validated attention identity and atomic attempt admission. Both are included above; navigation params and the existing in-memory notification dedupe are not used as authority or durable send accounting.
