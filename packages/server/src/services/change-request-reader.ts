import type { ChangeRequestRead } from "@getpaseo/protocol/messages";
import type { ChangeRequestRouter } from "./change-request-router.js";
import { createPullRequestService } from "./pull-request-service.js";

export { CHANGE_REQUEST_READ_TTL_MS, toChangeRequestRead } from "./pull-request-service.js";

export interface ChangeRequestReader {
  /**
   * One result per URL, in order. A URL the router can't place, or a forge read error, is
   * `ok: false` with a `reason`; `paused` carries `retryAt`.
   */
  read(urls: string[], options?: { caller?: string }): Promise<ChangeRequestRead[]>;
}

export interface CreateChangeRequestReaderOptions {
  router: ChangeRequestRouter;
  now?: () => number;
}

/**
 * One-shot reads only, over a pull request service with no subscribers. The daemon passes its
 * one service as the reader instead, so reads and subscriptions share a cache.
 */
export function createChangeRequestReader({
  router,
  now,
}: CreateChangeRequestReaderOptions): ChangeRequestReader {
  return createPullRequestService({ router, now, forges: [] });
}
