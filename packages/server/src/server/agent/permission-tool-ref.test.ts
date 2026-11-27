import { expect, test } from "vitest";
import { mcpToolOfPermission } from "./permission-tool-ref.js";

test.each([
  ["mcp__prs__prs_link", { kind: "mcp", server: "prs", tool: "prs_link" }],
  ["prs__prs_link", { kind: "mcp", server: "prs", tool: "prs_link" }],
  ["prs_prs_link", { kind: "mcp", server: "prs", tool: "prs_link" }],
  ["prs.prs_link", { kind: "mcp", server: "prs", tool: "prs_link" }],
  ["prs/prs_link", { kind: "mcp", server: "prs", tool: "prs_link" }],
  ["prs_admin_reset", { kind: "mcp", server: "prs_admin", tool: "reset" }],
  ["Bash", undefined],
  ["prs", undefined],
  ["prs_", undefined],
])("%s", (name, expected) => {
  expect(mcpToolOfPermission(name, ["prs", "prs_admin"])).toEqual(expected);
});
