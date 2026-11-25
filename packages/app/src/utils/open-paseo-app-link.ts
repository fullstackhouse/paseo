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

export interface LinkOpeners {
  openAppLink: (link: PaseoAppLink) => void;
  openExternal: (url: string) => Promise<void>;
}

const DEFAULT_LINK_OPENERS: LinkOpeners = {
  openAppLink: openPaseoAppLink,
  openExternal: openExternalUrl,
};

/** Sends a `paseo://` workspace or agent link to `openAppLink`, and any other URL to `openExternal`. */
export async function openLinkWith(url: string, openers: LinkOpeners): Promise<void> {
  const appLink = parsePaseoAppLink(url);
  if (appLink) {
    openers.openAppLink(appLink);
    return;
  }
  await openers.openExternal(url);
}

/**
 * Opens `paseo://` workspace and agent links in the app, and http(s) links outside it.
 * Other URLs, including `paseo://` links to anything else, are ignored.
 */
export function openUrlOrPaseoAppLink(url: string): Promise<void> {
  return openLinkWith(url, DEFAULT_LINK_OPENERS);
}
