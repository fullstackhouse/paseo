import {
  parseHostAgentRouteFromPathname,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";

export type PaseoAppLink =
  | { kind: "workspace"; serverId: string; workspaceId: string }
  | { kind: "agent"; serverId: string; agentId: string };

const APP_LINK_PATTERN = /^paseo:\/\/(h\/[^?#]*)/i;

/** Reads a `paseo://h/<server>/workspace/<id>` or `paseo://h/<server>/agent/<id>` link. */
export function parsePaseoAppLink(url: string): PaseoAppLink | null {
  const match = APP_LINK_PATTERN.exec(url.trim());
  if (!match?.[1]) return null;
  const pathname = `/${match[1]}`;
  const workspace = parseHostWorkspaceRouteFromPathname(pathname);
  if (workspace) return { kind: "workspace", ...workspace };
  const agent = parseHostAgentRouteFromPathname(pathname);
  if (agent) return { kind: "agent", ...agent };
  return null;
}
