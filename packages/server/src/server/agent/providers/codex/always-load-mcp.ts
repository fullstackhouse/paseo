import type { McpServerConfig } from "../../agent-sdk-types.js";

/**
 * Codex defers every MCP tool behind its tool search and has no per-server
 * setting to load one eagerly, so `alwaysLoad` (honored by Claude) has no
 * Codex equivalent. The model never sees deferred tools, or the server
 * instructions Codex attaches to their descriptions, unless it searches for
 * them. Name the servers in the developer instructions so it does.
 */
export function codexAlwaysLoadMcpNote(
  mcpServers: Record<string, McpServerConfig> | undefined,
): string | undefined {
  const names = Object.entries(mcpServers ?? {})
    .filter(([, config]) => config.alwaysLoad === true)
    .map(([name]) => name);
  if (names.length === 0) return undefined;

  const list = names.map((name) => `- \`${name}\`: tools named \`mcp__${name}__*\``).join("\n");
  return [
    "These MCP servers are part of your normal workflow in every turn, but their tools are loaded on demand, so they are not listed among your tools yet:",
    list,
    "Before your first reply, look these tools up with your tool search and read their descriptions in full. The descriptions include the server's rules for when to call each tool. Follow those rules for the rest of the session.",
  ].join("\n");
}
