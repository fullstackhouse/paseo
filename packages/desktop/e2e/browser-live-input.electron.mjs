import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { WebSocket } from "ws";

// Real Electron only, because no fake reproduces these: webContents.insertText kills the renderer
// when a cross-origin iframe has focus, a cleared field comes back with execCommand("undo"), an
// evaluate promise outlives its document, a dialog holds up Page.enable, input into a transformed
// iframe goes through Chromium's hit testing, the first press in a tab without focus can blur the
// field it focused, and frames race navigation commits.
const SECRET = "live-input-dummy-secret";
const FIELD_HEIGHT = 80;
const WAIT_MS = 15_000;
const QUIET_MS = 1_500;
const CODE = "482915";
// The embedded field's center, in the transformed iframe's own pixels.
const AIM = { x: 475, y: 230 };
// Where each transform puts that point on the screen.
const TRANSFORMS = [
  {
    name: "scaled",
    style: "left:40px;top:40px;border:4px solid;padding:6px;transform:scale(.5)",
    point: { x: 282.5, y: 160 },
  },
  {
    name: "rotated",
    style: "left:400px;top:40px;transform:rotate(90deg) scale(.6)",
    point: { x: 262, y: 325 },
  },
  {
    name: "perspective",
    style: "left:40px;top:40px;transform:perspective(800px) rotateY(20deg)",
    point: { x: 411, y: 231.2 },
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(`Live input: ${message}`);
}

async function startPages() {
  let port = 0;
  const hits = { beat: 0, ran: 0, click: 0 };
  const held = [];
  const field = `<input type="password" style="display:block;margin:0;box-sizing:border-box;width:100%;height:${FIELD_HEIGHT}px">`;
  const routes = {
    "/frame": () => `<!doctype html><body style="margin:0">${field}<script>
      addEventListener("input", (event) => parent.postMessage(event.target.value.length, "*"));
      addEventListener("load", () => parent.postMessage("ready", "*"));
    </script></body>`,
    // localhost and 127.0.0.1 are different sites, so the iframe gets its own process.
    "/": () => `<!doctype html><body style="margin:0">${field}
      <iframe src="http://localhost:${port}/frame" style="display:block;border:0;width:100%;height:${FIELD_HEIGHT}px"></iframe>
      <script>
        window.frameLengths = [];
        addEventListener("message", ({ data }) => data === "ready" ? (window.ready = true) : frameLengths.push(data));
      </script>
    </body>`,
    "/plain": () => `<!doctype html><body style="margin:0;background:white"><h1>plain</h1></body>`,
    "/target": () => `<!doctype html><body style="margin:0">
      <input type="password" style="position:absolute;margin:0;box-sizing:border-box;left:400px;top:200px;width:150px;height:60px">
      <script>
        addEventListener("mousedown", (event) => parent.postMessage([event.clientX, event.clientY], "*"));
        addEventListener("load", () => parent.postMessage("ready", "*"));
      </script></body>`,
    "/transformed": (query) => `<!doctype html><body style="margin:0">
      <script>
        window.taps = [];
        addEventListener("message", ({ data }) => data === "ready" ? (window.ready = true) : taps.push(data));
      </script>
      <iframe src="http://localhost:${port}/target" style="position:absolute;display:block;box-sizing:content-box;margin:0;width:600px;height:300px;border:0;transform-origin:0 0;${TRANSFORMS[Number(query.get("case"))].style}"></iframe>
    </body>`,
    "/code": () => `<!doctype html><body style="margin:0"><form>
      ${`<input maxlength="1" inputmode="numeric" style="margin:0;box-sizing:border-box;width:100px;height:${FIELD_HEIGHT}px;vertical-align:top">`.repeat(CODE.length)}
      </form>${field}<script>
        window.filled = 0;
        const boxes = [...document.querySelectorAll("form input")];
        boxes.forEach((box, index) => box.addEventListener("input", () => {
          filled = Math.max(filled, boxes.filter((next) => next.value).length);
          if (box.value) boxes[index + 1]?.focus();
        }));
      </script></body>`,
    "/old-document":
      () => `<!doctype html><body style="margin:0;background:#f00;height:100vh;overflow:hidden">
      <p id="tick">0</p>
      <script>
        setInterval(() => (tick.textContent = Math.random()), 16);
        addEventListener("click", () => (location.href = "http://localhost:${port}/new-document"));
      </script></body>`,
  };
  const server = createServer((request, response) => {
    const { pathname, searchParams } = new URL(request.url, "http://localhost");
    if (pathname.startsWith("/hit/")) {
      hits[pathname.slice("/hit/".length)] += 1;
      response.end();
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    if (pathname === "/held") {
      response.write("<!doctype html><body><p>still loading</p>");
      held.push(response);
      return;
    }
    if (pathname === "/new-document") {
      // Committed long before it paints.
      response.write(`<!doctype html><html><head><script>
        addEventListener("mousedown", () => navigator.sendBeacon("/hit/click"));
      </script>${" ".repeat(2048)}`);
      const body = `</head><body style="margin:0;background:#0f0;height:100vh"></body></html>`;
      setTimeout(() => response.end(body), QUIET_MS);
      return;
    }
    response.end(routes[pathname]?.(searchParams) ?? "");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  port = server.address().port;
  const topOrigin = `http://127.0.0.1:${port}`;
  return {
    url: `${topOrigin}/`,
    topOrigin,
    frameOrigin: `http://localhost:${port}`,
    hits,
    finishHeld: () => {
      for (const response of held.splice(0)) response.end("</body>");
    },
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
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

async function tap(viewer, point) {
  const { phone, streamId, documentId } = viewer;
  const tapped = await phone.sendBrowserLiveInput(streamId, { kind: "tap", documentId, ...point });
  assert(!tapped.error, `tap failed: ${tapped.error?.code}`);
  assert(tapped.focus, "tap focused no field");
  return tapped.focus;
}

async function typeSecret(viewer, focus, text = SECRET) {
  const typed = await viewer.phone.sendBrowserLiveInput(viewer.streamId, {
    kind: "insert_text",
    targetId: focus.targetId,
    text,
  });
  assert(!typed.error, `insert failed: ${typed.error?.code}`);
}

/** The phone's side of one stream: it acks what it got and aims at the newest. */
function createViewer({ phone, client, browserId, pages }) {
  const viewer = { phone, client, browserId, pages, streamId: null, documentId: null };
  viewer.frames = [];
  viewer.held = null;
  viewer.holdAcks = false;
  phone.subscribeBrowserLiveFrames(({ streamId, frameSeq, metadata, jpeg }) => {
    if (streamId !== viewer.streamId) return;
    viewer.documentId = metadata.documentId;
    viewer.frames.push({ origin: metadata.origin, jpeg: Buffer.from(jpeg).toString("base64") });
    if (viewer.holdAcks) viewer.held = { streamId, frameSeq };
    else phone.ackBrowserLiveFrame(streamId, frameSeq);
  });
  return viewer;
}

async function watch(viewer) {
  const { phone, browserId } = viewer;
  const started = await phone.startBrowserLiveView({ browserId });
  assert(started.streamId, `watching failed: ${started.error?.code}`);
  viewer.streamId = started.streamId;
  return started;
}

async function stopWatching(viewer) {
  await viewer.phone.stopBrowserLiveView(viewer.streamId);
  viewer.streamId = null;
}

async function show(viewer, path) {
  const { client, browserId, pages } = viewer;
  const before = viewer.documentId;
  const url = new URL(path, pages.url).href;
  const navigated = await callTool(client, "browser_navigate", { browserId, url });
  assert(navigated.ok, `couldn't open ${path}`);
  await waitFor(() => viewer.documentId !== before, `a frame of ${path}`);
}

async function takeControl(viewer, when) {
  const taken = await viewer.phone.takeBrowserLiveControl(viewer.streamId);
  assert(!taken.error, `take control failed ${when}: ${taken.error?.code}`);
}

async function handBack(viewer, when) {
  const released = await viewer.phone.releaseBrowserLiveControl(viewer.streamId);
  assert(!released.error, `hand-back failed ${when}: ${released.error?.code}`);
}

async function checkStuckCommands(viewer) {
  const { client, browserId, pages } = viewer;
  const evaluating = (source) =>
    callTool(client, "browser_evaluate", { browserId, function: source });
  const stuck = {
    awaiting: `() => new Promise(() => { setInterval(() => navigator.sendBeacon("/hit/beat"), 100); })`,
    busy: `() => { for (;;) {} }`,
  };
  const tookMs = {};
  for (const [name, source] of Object.entries(stuck)) {
    await show(viewer, "/plain");
    const before = pages.hits.beat;
    const command = evaluating(source);
    if (name === "awaiting") await waitFor(() => pages.hits.beat > before, "the agent's script");
    else await delay(QUIET_MS);
    const startedAt = Date.now();
    await takeControl(viewer, `over an ${name} script`);
    tookMs[name] = Date.now() - startedAt;
    const refused = await command;
    assert(refused.error?.code === "browser_human_control", `${name} script wasn't refused`);
    await delay(250); // Beacons already sent.
    const atGrant = pages.hits.beat;
    await delay(QUIET_MS);
    assert(pages.hits.beat === atGrant, `${name} script kept running under control`);
    await handBack(viewer, `after an ${name} script`);
  }

  await show(viewer, "/plain");
  await evaluate(client, browserId, `() => { setTimeout(() => (location.href = "/held")); }`);
  await delay(QUIET_MS);
  const waiting = evaluating(`() => navigator.sendBeacon("/hit/ran")`);
  await takeControl(viewer, "over a script that waits for loading");
  assert((await waiting).error?.code === "browser_human_control", "waiting script wasn't refused");
  pages.finishHeld();
  await delay(QUIET_MS);
  assert(pages.hits.ran === 0, "a cancelled script ran when loading stopped");
  await handBack(viewer, "after a script that waited for loading");
  return tookMs;
}

async function checkDialogs(viewer) {
  const { client, browserId } = viewer;
  const read = (key) => evaluate(client, browserId, `() => window.${key}`);
  const open = (source) =>
    evaluate(client, browserId, `() => { setTimeout(() => { ${source} }, 200); }`);

  await show(viewer, "/plain");
  await open(`window.beforeTake = confirm("before take")`);
  await delay(QUIET_MS);
  await takeControl(viewer, "behind an open dialog");
  await handBack(viewer, "after a dialog");
  assert((await read("beforeTake")) === false, "the open dialog wasn't dismissed");

  await open(`window.beforeWatch = confirm("before watch")`);
  await stopWatching(viewer);
  await delay(QUIET_MS);
  await watch(viewer);
  await takeControl(viewer, "after a dialog held up watching");
  await handBack(viewer, "after watching past a dialog");
  assert((await read("beforeWatch")) === false, "the dialog from before watching wasn't dismissed");

  await show(viewer, "/");
  await evaluate(
    client,
    browserId,
    `() => { setTimeout(() => { window.duringTake = confirm("during take") }, 2500); }`,
  );
  const blocked = callTool(client, "browser_evaluate", {
    browserId,
    function: `() => new Promise((resolve) => setTimeout(resolve, 4000))`,
  });
  await delay(250);
  await takeControl(viewer, "with a dialog during the drain");
  await blocked;
  await handBack(viewer, "after a dialog during take");
  assert((await read("duringTake")) === false, "the dialog during take wasn't dismissed");
}

async function checkTransformedIframes(viewer) {
  const { client, browserId, pages } = viewer;
  const landed = {};
  for (const [index, { name, point }] of TRANSFORMS.entries()) {
    await show(viewer, `/transformed?case=${index}`);
    await takeControl(viewer, `over a ${name} iframe`);
    const focus = await tap(viewer, point);
    assert(focus.origin === pages.frameOrigin, `the tap missed the ${name} iframe's field`);
    await handBack(viewer, `after a ${name} iframe`);
    const taps = await evaluate(client, browserId, "() => window.taps");
    assert(taps.length === 1, `the ${name} iframe got ${taps.length} taps`);
    const [x, y] = taps[0];
    const error = Math.max(Math.abs(x - AIM.x), Math.abs(y - AIM.y));
    assert(error <= 3, `the ${name} tap was ${error} px off`);
    landed[name] = [x, y];
  }
  return landed;
}

async function checkCodeBoxes(viewer) {
  const { client, browserId } = viewer;
  await show(viewer, "/code");
  await takeControl(viewer, "over code boxes");
  const box = await tap(viewer, { x: 40, y: FIELD_HEIGHT / 2 });
  assert(box.kind === "one_time_code", `a code box was shown as ${box.kind}`);
  await typeSecret(viewer, box, CODE);
  await typeSecret(viewer, await tap(viewer, { x: 20, y: FIELD_HEIGHT * 1.5 }));
  await handBack(viewer, "after a code");
  assert((await evaluate(client, browserId, "() => filled")) === CODE.length, "the code was cut");

  await evaluate(
    client,
    browserId,
    `() => { document.querySelector("input[type=password]").value = "agent"; }`,
  );
  await takeControl(viewer, "a second time over code boxes");
  await typeSecret(viewer, await tap(viewer, { x: 40, y: FIELD_HEIGHT / 2 }), CODE);
  await handBack(viewer, "after a second code");
  const left = await evaluate(
    client,
    browserId,
    `() => [...document.querySelectorAll("input")].map((input) => input.value).join("")`,
  );
  assert(left === "agent", "hand-back cleared the wrong control's fields");
}

async function checkNavigationFrames(viewer) {
  const { phone, client, browserId, pages } = viewer;
  await show(viewer, "/old-document");
  await takeControl(viewer, "before a navigation");
  viewer.frames.length = 0;
  viewer.holdAcks = true;
  await waitFor(() => viewer.held, "a frame to hold");
  const { documentId } = viewer;
  // An animated page has the next frame waiting in the desktop by the time it navigates.
  await delay(500);
  const aimed = { kind: "tap", documentId, x: 200, y: 300 };
  const clicked = await phone.sendBrowserLiveInput(viewer.streamId, aimed);
  assert(!clicked.error, `the navigating tap failed: ${clicked.error?.code}`);
  await delay(500);
  const stale = await phone.sendBrowserLiveInput(viewer.streamId, aimed);
  assert(stale.error?.code === "page_changed", "a tap on the previous document was accepted");
  const scrolled = await phone.sendBrowserLiveInput(viewer.streamId, {
    ...aimed,
    kind: "scroll",
    deltaX: 0,
    deltaY: 100,
  });
  assert(scrolled.error?.code === "page_changed", "a scroll on the previous document was accepted");

  viewer.holdAcks = false;
  phone.ackBrowserLiveFrame(viewer.held.streamId, viewer.held.frameSeq);
  viewer.held = null;
  await waitFor(() => viewer.documentId !== documentId, "a frame of the new document");
  await delay(QUIET_MS);
  await handBack(viewer, "after a navigation");
  assert(pages.hits.click === 0, "the new document got the stale tap");

  const frames = viewer.frames.slice();
  const colors = await evaluate(
    client,
    browserId,
    `() => Promise.all(${JSON.stringify(frames.map((frame) => frame.jpeg))}.map(async (data) => {
      const image = new Image();
      image.src = "data:image/jpeg;base64," + data;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const [red, green] = context.getImageData(image.width / 2, image.height - 10, 1, 1).data;
      return red > green ? "old" : "new";
    }))`,
  );
  for (const [index, color] of colors.entries()) {
    const expected = color === "old" ? pages.topOrigin : pages.frameOrigin;
    assert(frames[index].origin === expected, `${color} pixels carried ${frames[index].origin}`);
  }
  assert(colors.includes("old") && colors.includes("new"), "the navigation wasn't captured");
  return colors;
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
      () => evaluate(client, browserId, "() => window.ready === true").catch(() => false),
      "the test page",
    );

    const viewer = createViewer({ phone, client, browserId, pages });
    const { control } = await watch(viewer);
    assert(control?.held === false, "watching must start without control");
    await waitFor(() => viewer.documentId, "the first frame");
    const watched = await callTool(client, "browser_snapshot", { browserId });
    assert(watched.ok, "watching locked the agent out");

    await takeControl(viewer, "of the test page");
    const refused = await callTool(client, "browser_evaluate", { browserId, function: "() => 1" });
    assert(refused.error?.code === "browser_human_control", "the agent read around the lock");

    const embedded = await tap(viewer, { x: 20, y: FIELD_HEIGHT * 1.5 });
    assert(embedded.origin === pages.frameOrigin, `iframe origin was ${embedded.origin}`);
    assert(embedded.topOrigin === pages.topOrigin, `top origin was ${embedded.topOrigin}`);
    await typeSecret(viewer, embedded);

    await handBack(viewer, "of the test page");
    const lengths = await evaluate(client, browserId, "() => window.frameLengths");
    assert(lengths.includes(SECRET.length), "the cross-origin iframe never received the text");
    assert(lengths.at(-1) === 0, "hand-back left the password in the field");

    const transformed = await checkTransformedIframes(viewer);
    await checkCodeBoxes(viewer);
    const navigationFrames = await checkNavigationFrames(viewer);
    await checkDialogs(viewer);
    const stuckTookMs = await checkStuckCommands(viewer);

    await show(viewer, "/");
    await takeControl(viewer, "before the auto-release");
    await typeSecret(viewer, await tap(viewer, { x: 20, y: FIELD_HEIGHT / 2 }));
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

    return { frameLengths: lengths, transformed, navigationFrames, stuckTookMs, recovered };
  } finally {
    await phone.patchDaemonConfig({ browserLiveView: false }).catch(() => undefined);
    await phone.close();
    await pages.close();
  }
}
