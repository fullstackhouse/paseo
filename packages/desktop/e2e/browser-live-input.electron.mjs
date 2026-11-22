import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { WebSocket } from "ws";

// Real Electron only: webContents.insertText kills the renderer when a cross-origin iframe has
// focus, and a cleared field comes back with execCommand("undo"). No fake reproduces either.
const SECRET = "live-input-dummy-secret";
const FIELD_HEIGHT = 80;
const WAIT_MS = 15_000;

function assert(condition, message) {
  if (!condition) throw new Error(`Live input: ${message}`);
}

async function startPages() {
  let port = 0;
  const field = `<input type="password" style="display:block;margin:0;box-sizing:border-box;width:100%;height:${FIELD_HEIGHT}px">`;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (request.url === "/frame") {
      response.end(`<!doctype html><body style="margin:0">${field}<script>
        addEventListener("input", (event) => parent.postMessage(event.target.value.length, "*"));
      </script></body>`);
      return;
    }
    // localhost and 127.0.0.1 are different sites, so the iframe gets its own process.
    response.end(`<!doctype html><body style="margin:0">${field}
      <iframe src="http://localhost:${port}/frame" style="display:block;border:0;width:100%;height:${FIELD_HEIGHT}px"></iframe>
      <script>window.frameLengths = []; addEventListener("message", (event) => frameLengths.push(event.data));</script>
    </body>`);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}/`,
    topOrigin: `http://127.0.0.1:${port}`,
    frameOrigin: `http://localhost:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function callTool(client, name, args) {
  const result = await client.callTool({ name, args });
  return result.structuredContent;
}

async function evaluate(client, browserId, source) {
  const payload = await callTool(client, "browser_evaluate", { browserId, function: source });
  assert(payload.ok, `browser_evaluate failed: ${JSON.stringify(payload.error)}`);
  return JSON.parse(payload.result.resultJson);
}

async function openPage(client, url) {
  const listed = await callTool(client, "browser_list_tabs", {});
  const tab = listed.ok ? listed.result.tabs[0] : undefined;
  const opened = tab
    ? await callTool(client, "browser_navigate", { browserId: tab.browserId, url })
    : await callTool(client, "browser_new_tab", { url });
  assert(opened.ok, `couldn't open the test page: ${JSON.stringify(opened.error)}`);
  return tab?.browserId ?? opened.result.browserId;
}

async function waitFor(check, description) {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(250);
  }
  throw new Error(`Live input: timed out waiting for ${description}`);
}

async function tap(phone, streamId, y) {
  const tapped = await phone.sendBrowserLiveInput(streamId, { kind: "tap", x: 20, y });
  assert(!tapped.error, `tap failed: ${tapped.error?.code}`);
  assert(tapped.focus, "tap focused no field");
  return tapped.focus;
}

async function typeSecret(phone, streamId, focus) {
  const typed = await phone.sendBrowserLiveInput(streamId, {
    kind: "insert_text",
    targetId: focus.targetId,
    text: SECRET,
  });
  assert(!typed.error, `insert failed: ${typed.error?.code}`);
}

/** Types into a cross-origin iframe as the phone does, then checks hand-back and auto-release. */
export async function runLiveInputRegression({ daemonPort, client }) {
  const pages = await startPages();
  const phone = new DaemonClient({
    url: `ws://127.0.0.1:${daemonPort}/ws`,
    clientId: "live-input-regression-phone",
    clientType: "mobile",
    webSocketFactory: (url, options) =>
      new WebSocket(url, options?.protocols, { headers: options?.headers }),
  });
  try {
    await phone.connect();
    await phone.patchDaemonConfig({ browserLiveView: true });
    const browserId = await openPage(client, pages.url);
    await waitFor(
      () =>
        evaluate(client, browserId, "() => document.querySelector('iframe') !== null").catch(
          () => false,
        ),
      "the test page",
    );

    let frames = 0;
    phone.subscribeBrowserLiveFrames(({ streamId, frameSeq }) => {
      frames += 1;
      phone.ackBrowserLiveFrame(streamId, frameSeq);
    });
    const { streamId, control } = await phone.startBrowserLiveView({ browserId });
    assert(streamId && control?.held === false, "watching must start without control");
    await waitFor(() => frames > 0, "the first frame");
    const watched = await callTool(client, "browser_snapshot", { browserId });
    assert(watched.ok, "watching locked the agent out");

    assert(!(await phone.takeBrowserLiveControl(streamId)).error, "take control failed");
    const refused = await callTool(client, "browser_evaluate", { browserId, function: "() => 1" });
    assert(refused.error?.code === "browser_human_control", "the agent read around the lock");

    const embedded = await tap(phone, streamId, FIELD_HEIGHT * 1.5);
    assert(embedded.origin === pages.frameOrigin, `iframe origin was ${embedded.origin}`);
    assert(embedded.topOrigin === pages.topOrigin, `top origin was ${embedded.topOrigin}`);
    await typeSecret(phone, streamId, embedded);

    assert(!(await phone.releaseBrowserLiveControl(streamId)).error, "hand-back failed");
    const lengths = await evaluate(client, browserId, "() => window.frameLengths");
    assert(lengths.includes(SECRET.length), "the cross-origin iframe never received the text");
    assert(lengths.at(-1) === 0, "hand-back left the password in the field");

    assert(!(await phone.takeBrowserLiveControl(streamId)).error, "second take control failed");
    await typeSecret(phone, streamId, await tap(phone, streamId, FIELD_HEIGHT / 2));
    // Switching the setting off is a release the user didn't ask for, so it discards.
    await phone.patchDaemonConfig({ browserLiveView: false });
    const recovered = await waitFor(async () => {
      const payload = await callTool(client, "browser_evaluate", {
        browserId,
        function: `() => {
          const field = document.querySelector("input");
          field.focus();
          const values = [field.value];
          for (const command of ["undo", "undo", "redo", "redo"]) {
            document.execCommand(command);
            values.push(field.value);
          }
          return { values, entries: history.length };
        }`,
      });
      return payload.ok ? JSON.parse(payload.result.resultJson) : null;
    }, "the auto-release");
    assert(
      recovered.values.every((value) => value === ""),
      "undo brought the discarded password back",
    );
    assert(recovered.entries === 1, "history still reaches the discarded document");

    return { frames, frameLengths: lengths, recovered };
  } finally {
    await phone.patchDaemonConfig({ browserLiveView: false }).catch(() => undefined);
    await phone.close();
    await pages.close();
  }
}
