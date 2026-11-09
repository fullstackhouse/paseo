import type { Logger } from "pino";
import type { SnoozedPermissionBehavior } from "@getpaseo/protocol/messages";
import type { PersistedWorkspaceRecord, WorkspaceRegistry } from "../workspace-registry.js";

// setTimeout overflows past ~24.8 days; longer snoozes re-arm at this cap.
const MAX_TIMER_MS = 2_147_483_647;

type SnoozeFields = Pick<PersistedWorkspaceRecord, "snoozedAt" | "snoozedUntil">;

export type SnoozedAttention = "notify" | "quiet" | "wake";

export interface ResolveSnoozedAttentionInput {
  workspace: SnoozeFields | null;
  reason: "finished" | "error" | "permission";
  permissionBehavior: SnoozedPermissionBehavior | undefined;
  nowMs: number;
}

export interface WakeWorkspaceInput {
  registry: Pick<WorkspaceRegistry, "update">;
  workspaceId: string;
  nowIso: string;
}

export interface WorkspaceSnoozeWakerOptions {
  workspaceRegistry: Pick<WorkspaceRegistry, "list" | "update" | "subscribeToMutations">;
  logger: Logger;
  now?: () => number;
  /** Called once per timed snooze that ends with a wake prompt, with the record as it was snoozed. */
  onWakePrompt?: (workspace: PersistedWorkspaceRecord) => Promise<void>;
}

export interface WorkspaceSnoozeWaker {
  close: () => void;
}

/** A snooze whose time has passed counts as awake even before the waker clears it. */
export function isWorkspaceSnoozed(workspace: SnoozeFields, nowMs: number): boolean {
  if (!workspace.snoozedAt) return false;
  if (!workspace.snoozedUntil) return true;
  return Date.parse(workspace.snoozedUntil) > nowMs;
}

/**
 * Snoozed workspaces never notify for finished or failed turns. A permission prompt follows the
 * host's `snoozedPermission` setting: `wake` (default) un-snoozes and notifies, the rest stay quiet.
 */
export function resolveSnoozedAttention(input: ResolveSnoozedAttentionInput): SnoozedAttention {
  if (!input.workspace || !isWorkspaceSnoozed(input.workspace, input.nowMs)) return "notify";
  if (input.reason !== "permission") return "quiet";
  return (input.permissionBehavior ?? "wake") === "wake" ? "wake" : "quiet";
}

/**
 * Ends a snooze and drops its wake prompt. Returns the record as it was while snoozed, or null
 * when it was already awake, so concurrent wakers act on a snooze exactly once.
 */
export async function wakeWorkspace(
  input: WakeWorkspaceInput,
): Promise<PersistedWorkspaceRecord | null> {
  let snoozed: PersistedWorkspaceRecord | null = null;
  await input.registry.update(input.workspaceId, (existing) => {
    if (!existing.snoozedAt) return existing;
    snoozed = existing;
    return {
      ...existing,
      snoozedAt: null,
      snoozedUntil: null,
      snoozeWakePrompt: null,
      updatedAt: input.nowIso,
    };
  });
  return snoozed;
}

/** Clears timed snoozes when they end, so every client sees the workspace wake. */
export function setupWorkspaceSnoozeWaker(
  options: WorkspaceSnoozeWakerOptions,
): WorkspaceSnoozeWaker {
  const log = options.logger.child({ module: "workspace-snooze" });
  const now = options.now ?? Date.now;
  let timer: NodeJS.Timeout | null = null;
  let closed = false;

  function clearTimer(): void {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  async function arm(): Promise<void> {
    const nowMs = now();
    const workspaces = await options.workspaceRegistry.list();
    let nextMs = Number.POSITIVE_INFINITY;
    for (const workspace of workspaces) {
      if (workspace.archivedAt || !workspace.snoozedAt || !workspace.snoozedUntil) continue;
      const untilMs = Date.parse(workspace.snoozedUntil);
      if (Number.isNaN(untilMs)) continue;
      if (untilMs > nowMs) {
        nextMs = Math.min(nextMs, untilMs);
        continue;
      }
      const snoozed = await wakeWorkspace({
        registry: options.workspaceRegistry,
        workspaceId: workspace.workspaceId,
        nowIso: new Date(nowMs).toISOString(),
      });
      if (!snoozed) continue;
      log.info({ workspaceId: workspace.workspaceId }, "snooze ended");
      if (snoozed.snoozeWakePrompt && options.onWakePrompt) {
        // Never block other wake-ups on an agent run.
        options
          .onWakePrompt(snoozed)
          .catch((err) =>
            log.warn(
              { err, workspaceId: workspace.workspaceId },
              "failed to send snooze wake prompt",
            ),
          );
      }
    }
    // Concurrent arms each read the full list, so the last one to finish holds the right timer.
    clearTimer();
    if (closed || nextMs === Number.POSITIVE_INFINITY) return;
    timer = setTimeout(rearm, Math.min(nextMs - nowMs, MAX_TIMER_MS));
    timer.unref?.();
  }

  function rearm(): void {
    if (closed) return;
    arm().catch((err) => log.warn({ err }, "failed to schedule snooze wake-ups"));
  }

  // A cleared or removed snooze can leave an early timer behind; it re-reads the list and finds nothing.
  const unsubscribe = options.workspaceRegistry.subscribeToMutations?.((mutation) => {
    if (mutation.workspace?.snoozedUntil) rearm();
  });
  rearm();

  return {
    close: () => {
      closed = true;
      unsubscribe?.();
      clearTimer();
    },
  };
}
