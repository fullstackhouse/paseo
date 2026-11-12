import type { PullRequestPanelProps } from "@getpaseo/plugin/client/ui";
import { PullRequestPaneView } from "@/git/pull-request-panel/view";
import { mapPluginPullRequest } from "./pull-request-data";

/** The same presentation as Explorer, without its workspace actions or connection. */
export function PullRequestPanel({ data, ...props }: PullRequestPanelProps) {
  return <PullRequestPaneView {...props} data={mapPluginPullRequest(data)} />;
}
