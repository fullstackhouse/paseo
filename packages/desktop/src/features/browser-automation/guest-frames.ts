import { randomUUID } from "node:crypto";

// Electron main talks to the guest preload of one frame at a time. The preload imports only the
// types, because a sandboxed preload can't require local modules.
const CONTROL_CHANNEL = "paseo:browser-human-control";
export const GUEST_CONTROL_REPLY_CHANNEL = "paseo:browser-human-control-reply";

export type GuestControlRequest =
  | { id: string; op: "describe" }
  | { id: string; op: "insert"; targetId: string; text: string; deadline: number }
  | { id: string; op: "clear"; scope: "all" | "secrets" };

export type GuestFieldKind =
  | "password"
  | "new_password"
  | "one_time_code"
  | "secret"
  | "username"
  | "email"
  | "text";

export interface GuestControlReply {
  id: string;
  target?: { targetId: string; kind: GuestFieldKind } | null;
  inserted?: boolean;
  /** The document holds a field live view typed into. */
  typed?: boolean;
}

export interface GuestFrame {
  readonly processId: number;
  readonly routingId: number;
  readonly origin: string;
  readonly url: string;
  readonly detached: boolean;
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
}

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

interface PendingReply {
  processId: number;
  routingId: number;
  timeout: ReturnType<typeof setTimeout>;
  resolve(reply: GuestControlReply | null): void;
}

export class GuestFrames {
  private readonly pending = new Map<string, PendingReply>();

  /** Null means no answer: the frame is gone, hung, or its process died. */
  public ask(
    frame: GuestFrame,
    request: WithoutId<GuestControlRequest>,
    timeoutMs: number,
  ): Promise<GuestControlReply | null> {
    if (frame.isDestroyed() || frame.detached) return Promise.resolve(null);
    const id = randomUUID();
    return new Promise((resolve) => {
      const { processId, routingId } = frame;
      const timeout = setTimeout(() => this.settle(id, null), timeoutMs);
      this.pending.set(id, { processId, routingId, timeout, resolve });
      try {
        frame.send(CONTROL_CHANNEL, { id, ...request });
      } catch {
        this.settle(id, null);
      }
    });
  }

  /** Only the frame that was asked can answer. */
  public receive(sender: { processId: number; frameId: number }, reply: unknown): void {
    if (typeof reply !== "object" || reply === null) return;
    const { id } = reply as { id?: unknown };
    if (typeof id !== "string") return;
    const pending = this.pending.get(id);
    if (!pending) return;
    if (pending.processId !== sender.processId || pending.routingId !== sender.frameId) return;
    this.settle(id, reply as GuestControlReply);
  }

  private settle(id: string, reply: GuestControlReply | null): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timeout);
    pending.resolve(reply);
  }
}
