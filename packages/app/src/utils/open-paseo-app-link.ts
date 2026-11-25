import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { openExternalUrl } from "@/utils/open-external-url";
import { parsePaseoAppLink, type PaseoAppLink } from "@/utils/paseo-app-link";
import { requestWorkspaceRecoveryFromLink } from "@/workspace-recovery/link-requests";

/** Opens a parsed `paseo://` link inside the app instead of handing it to the OS. */
export function openPaseoAppLink(link: PaseoAppLink): void {
  if (link.kind === "workspace") {
    requestWorkspaceRecoveryFromLink(link);
    navigateToWorkspace({ serverId: link.serverId, workspaceId: link.workspaceId });
    return;
  }
  navigateToAgent({ serverId: link.serverId, agentId: link.agentId });
}

/** Opens `paseo://` workspace and agent links in the app, and http(s) links outside it. */
export async function openUrlOrPaseoAppLink(url: string): Promise<void> {
  const appLink = parsePaseoAppLink(url);
  if (appLink) {
    openPaseoAppLink(appLink);
    return;
  }
  await openExternalUrl(url);
}
