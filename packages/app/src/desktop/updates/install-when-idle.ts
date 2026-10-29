// FSH fork: install a desktop update once the local host has no agent work in flight.
// Updating stops the local daemon, so only the local host's workspaces matter.
import type { WorkspaceStateBucket } from "@getpaseo/protocol/agent-state-bucket";

/** How long the local host has to stay idle before the update installs. */
export const IDLE_INSTALL_QUIET_MS = 15 * 1000;

export type LocalHostActivity = "busy" | "idle" | "unknown";

// `running` covers background shells and Monitor watches too. `needs_input` is a turn waiting
// on a permission prompt; restarting would drop it. A workspace still running its setup
// script is busy as well.
const BUSY_BUCKETS: ReadonlySet<WorkspaceStateBucket> = new Set(["running", "needs_input"]);

export function summarizeLocalHostActivity(
  session:
    | {
        hasHydratedWorkspaces: boolean;
        workspaces: ReadonlyMap<
          string,
          { status: WorkspaceStateBucket; setupStatus?: string | null }
        >;
      }
    | null
    | undefined,
): LocalHostActivity {
  if (!session?.hasHydratedWorkspaces) return "unknown";
  for (const workspace of session.workspaces.values()) {
    if (BUSY_BUCKETS.has(workspace.status) || workspace.setupStatus === "running") return "busy";
  }
  return "idle";
}

export interface IdleInstallTrigger {
  update(activity: LocalHostActivity): void;
  dispose(): void;
}

/** Calls `onIdle` once, after the activity has stayed `idle` for `quietMs` without a break. */
export function createIdleInstallTrigger(input: {
  quietMs: number;
  onIdle: () => void;
}): IdleInstallTrigger {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return {
    update(activity) {
      if (fired) return;
      if (activity !== "idle") {
        clear();
        return;
      }
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        fired = true;
        input.onIdle();
      }, input.quietMs);
    },
    dispose: clear,
  };
}
