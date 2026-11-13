import { describe, expect, it } from "vitest";

import { decideSubframeNavigation } from "./subframe-navigation";

const PACKAGED = "paseo://app/workspace/abc";
const DEV = "http://localhost:8081/workspace/abc";
const PDF_VIEWER = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html";

function decide(url: string, frameUrl: string | null = null, appUrl = PACKAGED) {
  return decideSubframeNavigation({ url, appUrl, frameUrl });
}

describe("decideSubframeNavigation", () => {
  it("loads the app's own frames", () => {
    expect(decide("blob:paseo://app/6c1f")).toBe("allow");
    expect(decide("blob:http://localhost:8081/6c1f", null, DEV)).toBe("allow");
    expect(decide("paseo://app/mermaid.html")).toBe("allow");
    expect(decide("about:srcdoc")).toBe("allow");
    expect(decide("about:blank")).toBe("allow");
    expect(decide(PDF_VIEWER, "blob:paseo://app/6c1f")).toBe("allow");
  });

  it("opens a link clicked inside a PDF in the system browser", () => {
    expect(decide("https://example.com/", "blob:paseo://app/6c1f")).toBe("open-external");
    expect(decide("http://example.com/", "blob:paseo://app/6c1f")).toBe("open-external");
    expect(decide("https://example.com/", PDF_VIEWER)).toBe("open-external");
  });

  it("blocks a preview's script from pulling in or opening a remote page", () => {
    expect(decide("https://example.com/", "about:srcdoc")).toBe("block");
    expect(decide("https://example.com/", null)).toBe("block");
  });

  it("blocks other origins and schemes", () => {
    expect(decide("blob:https://evil.example/6c1f", "blob:paseo://app/6c1f")).toBe("block");
    expect(decide("data:text/html,<script>top.location='x'</script>")).toBe("block");
    expect(decide("file:///etc/passwd", "blob:paseo://app/6c1f")).toBe("block");
    expect(decide("paseo://other/x")).toBe("block");
    expect(decide("http://localhost:9999/", null, DEV)).toBe("block");
    expect(decide("chrome-extension://someotherextension/index.html")).toBe("block");
    expect(decide("not a url")).toBe("block");
  });
});
