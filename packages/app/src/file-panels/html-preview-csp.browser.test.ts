import { afterEach, describe, expect, it } from "vitest";
import { withPreviewCsp } from "./html-preview-csp";

const mountedFrames: HTMLIFrameElement[] = [];

afterEach(() => {
  for (const frame of mountedFrames.splice(0)) frame.remove();
});

function nextMessage(frame: HTMLIFrameElement, timeoutMs = 3_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", receive);
      reject(new Error("Timed out waiting for the preview frame"));
    }, timeoutMs);
    function receive(event: MessageEvent): void {
      if (event.source !== frame.contentWindow) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
      resolve(event.data);
    }
    window.addEventListener("message", receive);
  });
}

describe("preview frame", () => {
  it("keeps fragment links inside the document", async () => {
    const frame = document.createElement("iframe");
    frame.sandbox.add("allow-scripts");
    frame.srcdoc = withPreviewCsp(
      [
        '<a id="link" href="#second">Second</a>',
        '<section id="second">Second</section>',
        "<script>",
        "addEventListener('hashchange', () => parent.postMessage(location.href, '*'));",
        "addEventListener('load', () => document.getElementById('link').click());",
        "</script>",
      ].join(""),
      { srcdoc: true },
    );
    const message = nextMessage(frame);
    document.body.append(frame);
    mountedFrames.push(frame);

    expect(await message).toBe("about:srcdoc#second");
  });
});
