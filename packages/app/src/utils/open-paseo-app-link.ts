import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import type { PaseoAppLink } from "@/utils/paseo-app-link";
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
