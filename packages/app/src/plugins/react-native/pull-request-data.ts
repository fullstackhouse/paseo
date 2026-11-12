import type { PullRequestPanelData } from "@getpaseo/plugin/client/ui";
import { deriveAvatarColor, formatAge, type PrPaneData } from "@/git/pull-request-panel/data";
import { getForgePresentation } from "@/git/forge";

/** Keep presentation fields host-owned when plugins supply forge data. */
export function mapPluginPullRequest(data: PullRequestPanelData, nowMs = Date.now()): PrPaneData {
  return {
    ...data,
    provider: { id: data.forge, label: getForgePresentation(data.forge).brandLabel },
    reviewDecision: "pending",
    awaitingReviewers: [],
    checks: data.checks.map((check) => ({ ...check, provider: data.forge })),
    activity: [...data.activity]
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      .map((activity) => ({
        id: activity.id,
        kind: activity.kind,
        author: activity.author,
        authorUrl: activity.authorUrl,
        avatarUrl: activity.avatarUrl,
        body: activity.body,
        url: activity.url,
        reviewState: activity.reviewState,
        reviewId: activity.reviewId,
        threadId: activity.threadId,
        threadIsResolved: activity.threadIsResolved,
        location: activity.location,
        provider: data.forge,
        avatarColor: deriveAvatarColor(activity.author),
        age: formatAge(Date.parse(activity.createdAt), nowMs),
      })),
  };
}
