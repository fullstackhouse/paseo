import type { McpToolRef } from "@getpaseo/protocol/agent-types";

/**
 * Separators providers put between an MCP server's name and its tool's name in a permission
 * request: Claude and Codex `mcp__prs__prs_link`, others `prs_prs_link`, `prs.prs_link`, `prs/prs_link`.
 */
const PREFIXES = [(server: string) => `mcp__${server}__`].concat(
  ["__", ".", "/", ":", "_"].map((separator) => (server: string) => `${server}${separator}`),
);

/**
 * The MCP tool a permission request is for, matched against the agent's own MCP server names so a
 * plugin can recognize its tools on any provider. Undefined when the request isn't for one of them.
 */
export function mcpToolOfPermission(
  name: string,
  servers: Iterable<string>,
): McpToolRef | undefined {
  // Longest name first: server `prs` must not claim a tool of server `prs_admin`.
  const sorted = [...new Set(servers)].sort((left, right) => right.length - left.length);
  for (const prefix of PREFIXES) {
    for (const server of sorted) {
      const start = prefix(server);
      if (name.startsWith(start) && name.length > start.length) {
        return { kind: "mcp", server, tool: name.slice(start.length) };
      }
    }
  }
  return undefined;
}
