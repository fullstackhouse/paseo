import type {
  PluginNotificationPayload,
  PluginNotificationSendRequest,
} from "@getpaseo/protocol/messages";

export type PluginNotificationInput = Omit<PluginNotificationSendRequest, "type" | "requestId">;

export const PLUGIN_NOTIFICATION_LIMITS = {
  titleLength: 120,
  bodyLength: 500,
  keyLength: 200,
  screenIdLength: 200,
  paramCount: 20,
  paramLength: 500,
  perPluginPerWindow: 20,
  rateWindowMs: 60_000,
  dedupeWindowMs: 60_000,
} as const;

export type PluginNotificationDrop = "muted" | "duplicate" | "rate_limited";

export type PluginNotificationResult =
  | { delivered: true }
  | { delivered: false; dropped: PluginNotificationDrop };

function assertLength(label: string, value: string, max: number): void {
  if (value.length > max) {
    throw new Error(`Plugin notification ${label} is longer than ${max} characters`);
  }
}

/** Throws a message the plugin can act on when the input breaks a limit. */
export function validatePluginNotificationInput(input: PluginNotificationInput): void {
  const limits = PLUGIN_NOTIFICATION_LIMITS;
  if (input.title.trim().length === 0) throw new Error("Plugin notification title is empty");
  assertLength("title", input.title, limits.titleLength);
  assertLength("body", input.body, limits.bodyLength);
  if (input.key !== undefined) {
    if (input.key.length === 0) throw new Error("Plugin notification key is empty");
    assertLength("key", input.key, limits.keyLength);
  }
  const open = input.open;
  if (!open) return;
  if ("screen" in open) {
    if ("agentId" in open) {
      throw new Error("Plugin notification opens either a screen or an agent, not both");
    }
    if (open.screen.trim().length === 0) throw new Error("Plugin notification screen is empty");
    assertLength("screen", open.screen, limits.screenIdLength);
    const params = Object.entries(open.params ?? {});
    if (params.length > limits.paramCount) {
      throw new Error(`Plugin notification has more than ${limits.paramCount} screen params`);
    }
    for (const [key, value] of params) {
      assertLength(`param ${key}`, key + value, limits.paramLength);
    }
    return;
  }
  if (open.agentId.trim().length === 0) throw new Error("Plugin notification agentId is empty");
}

export function buildPluginNotificationPayload(input: {
  serverId: string;
  pluginId: string;
  notification: PluginNotificationInput;
}): PluginNotificationPayload {
  const { open, key, title, body } = input.notification;
  let target: Partial<PluginNotificationPayload["data"]> = {};
  if (open && "screen" in open) {
    target = {
      screenId: open.screen,
      ...(open.params && Object.keys(open.params).length > 0 ? { params: { ...open.params } } : {}),
    };
  } else if (open) {
    target = { agentId: open.agentId };
  }
  return {
    title: title.trim(),
    body: body.trim(),
    data: {
      serverId: input.serverId,
      pluginId: input.pluginId,
      ...target,
      ...(key !== undefined ? { key } : {}),
    },
  };
}

/**
 * Drops a repeat of the same `key` inside the dedupe window, then caps each plugin at
 * `perPluginPerWindow` notifications per rate window. Duplicates do not spend the budget.
 * State is in memory: a daemon restart forgets it.
 */
export class PluginNotificationThrottle {
  private readonly sentAt = new Map<string, number[]>();
  private readonly keySentAt = new Map<string, number>();

  constructor(private readonly limits = PLUGIN_NOTIFICATION_LIMITS) {}

  admit(input: { pluginId: string; key?: string; nowMs: number }): PluginNotificationResult {
    const { pluginId, key, nowMs } = input;
    this.prune(nowMs);
    const dedupeKey = key === undefined ? null : `${pluginId}\u0000${key}`;
    if (dedupeKey !== null && this.keySentAt.has(dedupeKey)) {
      return { delivered: false, dropped: "duplicate" };
    }
    const sent = this.sentAt.get(pluginId) ?? [];
    if (sent.length >= this.limits.perPluginPerWindow) {
      return { delivered: false, dropped: "rate_limited" };
    }
    sent.push(nowMs);
    this.sentAt.set(pluginId, sent);
    if (dedupeKey !== null) this.keySentAt.set(dedupeKey, nowMs);
    return { delivered: true };
  }

  private prune(nowMs: number): void {
    for (const [pluginId, sent] of this.sentAt) {
      const recent = sent.filter((at) => nowMs - at < this.limits.rateWindowMs);
      if (recent.length > 0) this.sentAt.set(pluginId, recent);
      else this.sentAt.delete(pluginId);
    }
    for (const [key, at] of this.keySentAt) {
      if (nowMs - at >= this.limits.dedupeWindowMs) this.keySentAt.delete(key);
    }
  }
}
