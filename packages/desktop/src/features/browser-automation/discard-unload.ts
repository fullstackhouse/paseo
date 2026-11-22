import type { CdpMessageListener } from "./frame-sessions.js";

/**
 * Lets main's own discard navigation past beforeunload, once, and nothing the page started.
 * will-prevent-unload doesn't say whose navigation asks, so this follows CDP, which announces
 * each navigation before its beforeunload: Page.frameStartedNavigating for main's, and
 * Page.frameRequestedNavigation, in any frame's session, for a page's.
 */
export function ownDiscardUnload(
  discardUrl: string,
  onMessage: (listener: CdpMessageListener) => () => void,
) {
  let own = false;
  let refused = false;
  const pageStarted = new Set<unknown>();
  const dispose = onMessage((method, params, sessionId) => {
    if (method === "Page.frameRequestedNavigation") pageStarted.add(params.frameId);
    if (method === "Page.frameClearedScheduledNavigation") pageStarted.delete(params.frameId);
    if (method === "Page.frameStartedNavigating" && !sessionId) {
      // history.back() announces itself the same way, as historyDifferentDocument.
      own = params.navigationType === "differentDocument" && params.url === discardUrl;
    }
  });
  return {
    onUnload(event: { preventDefault(): void }): void {
      if (own && pageStarted.size === 0) {
        own = false;
        event.preventDefault();
      } else refused = true;
    },
    /** Something else's beforeunload got in the way of that attempt, so another can work. */
    takeRefused(): boolean {
      const was = refused;
      refused = false;
      return was;
    },
    dispose,
  };
}
