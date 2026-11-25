import type { WorkspaceInProgress } from "@/workspace-status";

export type InProgressBadge =
  | { kind: "notMoving"; count: number }
  | { kind: "inProgress"; count: number }
  | { kind: "awaitingReview"; count: number };

/**
 * Why in-progress work put the row where it is: entries nothing moves (wherever they are), then the
 * entries behind the row's group, only when they are its reason.
 */
export function selectInProgressBadges(input: Partial<WorkspaceInProgress>): InProgressBadge[] {
  const badges: InProgressBadge[] = [];
  if (input.notMoving) badges.push({ kind: "notMoving", count: input.notMoving });
  if (input.reason === "working" && input.reasonCount) {
    badges.push({ kind: "inProgress", count: input.reasonCount });
  }
  if (input.reason === "blocked" && input.reasonCount) {
    badges.push({ kind: "awaitingReview", count: input.reasonCount });
  }
  return badges;
}
