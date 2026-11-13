import type { BrowserWindow } from "electron";

/** Chromium's PDF viewer, which Electron mounts as a subframe of every PDF document. */
const PDF_VIEWER_ORIGIN = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai";

export type SubframeNavigationDecision = "allow" | "block" | "open-external";

/**
 * What a subframe of the app window may load. App frames (file previews, Mermaid, the PDF viewer)
 * only ever show the app's own documents, so anything else is a page trying to pull a remote site
 * into the window: a link clicked inside a PDF, or an HTML preview setting `location`.
 *
 * A link inside a PDF opens in the system browser. Other frames are only blocked, so a preview's
 * script cannot open browser tabs on a loop.
 */
export function decideSubframeNavigation(input: {
  url: string;
  appUrl: string;
  frameUrl: string | null;
}): SubframeNavigationDecision {
  const target = parseUrl(input.url);
  if (!target) return "block";
  if (target.protocol === "about:") return "allow";
  const app = parseUrl(input.appUrl);
  const targetOrigin =
    target.protocol === "blob:" ? originOf(parseUrl(target.pathname)) : originOf(target);
  if (app && targetOrigin !== null && targetOrigin === originOf(app)) return "allow";
  if (targetOrigin === PDF_VIEWER_ORIGIN) return "allow";
  const isWebLink = target.protocol === "https:" || target.protocol === "http:";
  const frame = parseUrl(input.frameUrl ?? "");
  const fromDocument = frame?.protocol === "blob:" || originOf(frame) === PDF_VIEWER_ORIGIN;
  return isWebLink && fromDocument ? "open-external" : "block";
}

export function registerSubframeNavigationGuard(
  win: BrowserWindow,
  openExternal: (url: string) => Promise<void>,
): void {
  win.webContents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame) return;
    const decision = decideSubframeNavigation({
      url: event.url,
      appUrl: win.webContents.getURL(),
      frameUrl: event.frame?.url ?? null,
    });
    if (decision === "allow") return;
    event.preventDefault();
    if (decision === "open-external") void openExternal(event.url).catch(() => undefined);
  });
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * `scheme://host`. Node's `URL.origin` is "null" for custom schemes such as `paseo:` and
 * `chrome-extension:`, which Chromium treats as standard. A blob's origin is its inner URL's.
 */
function originOf(url: URL | null): string | null {
  if (!url || !url.host) return null;
  return `${url.protocol}//${url.host}`;
}
