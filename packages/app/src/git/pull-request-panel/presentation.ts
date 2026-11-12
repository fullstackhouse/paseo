import { deriveIdentityColorName, identityColor } from "@/styles/identity-colors";
import type { PrPaneActivity, PrState } from "./data";

// Avatars are identity, not status: they draw from the shared identity table so a PR
// participant square sits at the same weight as a project icon. Logins are matched
// case-insensitively, so the same person keeps one color across forges.
export function deriveAvatarColor(login: string): string {
  return identityColor(deriveIdentityColorName(login.toLowerCase()));
}

export function formatAge(createdAtMs: number, nowMs = Date.now()): string {
  const elapsedMs = Math.max(0, nowMs - createdAtMs);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);

  if (elapsedSeconds < 60) {
    return "just now";
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 30) {
    return `${elapsedDays}d ago`;
  }

  if (elapsedDays < 365) {
    return `${Math.floor(elapsedDays / 30)}mo ago`;
  }

  return `${Math.floor(elapsedDays / 365)}y ago`;
}

export function getStateLabelKey(state: PrState) {
  if (state === "draft") return "workspace.git.pr.states.draft";
  if (state === "merged") return "workspace.git.pr.states.merged";
  if (state === "closed") return "workspace.git.pr.states.closed";
  return "workspace.git.pr.states.open";
}

export function getActivityVerbKey(item: Pick<PrPaneActivity, "kind" | "reviewState">) {
  if (item.kind === "comment") return "workspace.git.pr.activity.commented";
  if (item.reviewState === "approved") return "workspace.git.pr.activity.approved";
  if (item.reviewState === "changes_requested") {
    return "workspace.git.pr.activity.requestedChanges";
  }
  return "workspace.git.pr.activity.reviewed";
}
