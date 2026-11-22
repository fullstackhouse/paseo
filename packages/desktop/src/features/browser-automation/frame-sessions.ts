import type { CdpCommandSender } from "./cdp-session-queue.js";
import { toBoxPoint } from "./quad.js";

// An iframe in an iframe in an iframe is already more than a sign-in page uses.
const MAX_FRAME_DEPTH = 5;
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true } as const;

export type CdpSessionSender = (
  command: string,
  params?: Record<string, unknown>,
  sessionId?: string,
) => Promise<unknown>;

export type CdpMessageListener = (
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
) => void;

/**
 * CDP sessions of a tab's out-of-process iframes, while a human controls it. Root-session mouse
 * input is hit-tested in the window, where a tab that isn't on screen is parked at 1x1, so it
 * never reaches such an iframe. That iframe's own session does.
 */
export class FrameSessions {
  private readonly sessionIdByTargetId = new Map<string, string>();
  private readonly attaching = new Set<Promise<unknown>>();
  private readonly unsubscribe: () => void;

  public constructor(
    private readonly send: CdpSessionSender,
    onMessage: (listener: CdpMessageListener) => () => void,
  ) {
    this.unsubscribe = onMessage((method, params) => this.handleMessage(method, params));
  }

  public async attach(): Promise<void> {
    await this.send("Target.setAutoAttach", { ...AUTO_ATTACH });
    while (this.attaching.size > 0) await Promise.all(this.attaching);
  }

  /** The session that owns a point of the viewport, and the point in that session's viewport. */
  public async route(viewportPoint: {
    x: number;
    y: number;
  }): Promise<{ send: CdpCommandSender; point: { x: number; y: number } }> {
    let sessionId: string | undefined;
    let point = viewportPoint;
    for (let depth = 0; depth < MAX_FRAME_DEPTH && this.sessionIdByTargetId.size > 0; depth++) {
      const child = await this.childAt(point, sessionId).catch(() => null);
      if (!child) break;
      ({ sessionId, point } = child);
    }
    const target = sessionId;
    return { send: (command, params) => this.send(command, params, target), point };
  }

  public dispose(): void {
    this.unsubscribe();
    this.sessionIdByTargetId.clear();
    void this.send("Target.setAutoAttach", { ...AUTO_ATTACH, autoAttach: false }).catch(() => {});
  }

  private async childAt(point: { x: number; y: number }, sessionId: string | undefined) {
    const metrics = (await this.send("Page.getLayoutMetrics", {}, sessionId)) as {
      cssLayoutViewport?: { pageX?: number; pageY?: number };
    };
    const { pageX = 0, pageY = 0 } = metrics.cssLayoutViewport ?? {};
    // getNodeForLocation counts from the document, unlike quads and input.
    const { backendNodeId } = (await this.send(
      "DOM.getNodeForLocation",
      { x: Math.round(point.x + pageX), y: Math.round(point.y + pageY) },
      sessionId,
    )) as { backendNodeId?: number };
    if (backendNodeId === undefined) return null;
    const { node } = (await this.send("DOM.describeNode", { backendNodeId }, sessionId)) as {
      node?: { frameId?: string };
    };
    // An iframe's target id is its frame id. A same-process iframe has no session of its own.
    const childSessionId = node?.frameId ? this.sessionIdByTargetId.get(node.frameId) : undefined;
    if (!childSessionId) return null;
    const { model } = (await this.send("DOM.getBoxModel", { backendNodeId }, sessionId)) as {
      model?: { content?: number[]; border?: number[]; width?: number; height?: number };
    };
    const { content = [], border = [], width, height } = model ?? {};
    const [left, top] = content;
    if (!width || !height || left === undefined || top === undefined) return null;
    // Quads show the box after CSS transforms; width and height are its border box before them.
    const local = toBoxPoint(point, border, { width, height });
    const origin = toBoxPoint({ x: left, y: top }, border, { width, height });
    if (!local || !origin) return null;
    return { sessionId: childSessionId, point: { x: local.x - origin.x, y: local.y - origin.y } };
  }

  private handleMessage(method: string, params: Record<string, unknown>): void {
    if (method === "Target.detachedFromTarget") {
      for (const [targetId, sessionId] of this.sessionIdByTargetId) {
        if (sessionId === params.sessionId) this.sessionIdByTargetId.delete(targetId);
      }
      return;
    }
    if (method !== "Target.attachedToTarget") return;
    const { sessionId } = params;
    const { targetId } = (params.targetInfo ?? {}) as { targetId?: unknown };
    if (typeof sessionId !== "string" || typeof targetId !== "string") return;
    this.sessionIdByTargetId.set(targetId, sessionId);
    // Page for its dialogs, auto-attach for iframes inside it. A target can go away meanwhile.
    const setUp = Promise.all([
      this.send("Page.enable", {}, sessionId),
      this.send("Target.setAutoAttach", { ...AUTO_ATTACH }, sessionId),
    ]).catch(() => {});
    this.attaching.add(setUp);
    void setUp.finally(() => this.attaching.delete(setUp));
  }
}
