import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export function backgroundWorkText(
  item: { description: string | null; command?: string },
  kind: string,
): { title: string; command: string | null } {
  const title = item.description ?? item.command ?? kind;
  return { title, command: item.command && item.command !== title ? item.command : null };
}

export type BackgroundWorkState = "running" | "stopping" | "notRunning";

/**
 * Where a task stands, from whether the host still lists it and what a stop request is doing.
 * A task the host dropped stays on screen only while its stop is unresolved.
 */
export function backgroundWorkState({
  live,
  stopStatus,
}: {
  live: boolean;
  stopStatus?: "pending" | "error";
}): BackgroundWorkState {
  if (stopStatus === "pending") {
    return "stopping";
  }
  return live ? "running" : "notRunning";
}

/** The row's leading mark: the running ring while it runs, red once a stop could not be confirmed. */
export function backgroundWorkBucket({
  state,
  stopStatus,
}: {
  state: BackgroundWorkState;
  stopStatus?: "pending" | "error";
}): SidebarStateBucket {
  if (stopStatus === "error") {
    return "failed";
  }
  return state === "notRunning" ? "done" : "running";
}
