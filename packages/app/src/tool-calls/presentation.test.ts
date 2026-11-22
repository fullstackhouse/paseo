import type { AgentMessage } from "@getpaseo/protocol/agent-message";
import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { describe, expect, it } from "vitest";

import { buildToolCallPresentation, type ToolCallPresentationIcon } from "./presentation";

const fakeIcons = {
  paseo: (() => null) as ToolCallPresentationIcon,
  brain: (() => null) as ToolCallPresentationIcon,
  eye: (() => null) as ToolCallPresentationIcon,
  wrench: (() => null) as ToolCallPresentationIcon,
};

function fakeResolveIcon(
  toolName: string,
  detail: ToolCallDetail | undefined,
  agentMessage: AgentMessage | undefined,
): ToolCallPresentationIcon {
  if (agentMessage) {
    return fakeIcons.paseo;
  }
  if (detail?.type === "plan") {
    return fakeIcons.brain;
  }
  if (detail?.type === "read") {
    return fakeIcons.eye;
  }
  if (toolName === "exec_command") {
    return fakeIcons.wrench;
  }
  return fakeIcons.wrench;
}

describe("tool-call presentation", () => {
  it("builds badge, detail, icon, and file-open policy in one model", () => {
    const presentation = buildToolCallPresentation({
      toolName: "read_file",
      status: "completed",
      error: null,
      cwd: "/tmp/repo",
      detail: {
        type: "read",
        filePath: "/tmp/repo/src/index.ts",
        content: "console.log('hi');",
      },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation).toMatchObject({
      displayName: "Read",
      summary: "src/index.ts",
      icon: fakeIcons.eye,
      isLoadingDetails: false,
      hasDetails: true,
      canOpenDetails: true,
      openFilePath: "/tmp/repo/src/index.ts",
      isPlan: false,
    });
  });

  it("marks running calls without meaningful detail as loading details", () => {
    const presentation = buildToolCallPresentation({
      toolName: "exec_command",
      status: "running",
      error: null,
      detail: {
        type: "unknown",
        input: {},
        output: null,
      },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation).toMatchObject({
      displayName: "Exec command",
      icon: fakeIcons.wrench,
      isLoadingDetails: true,
      hasDetails: false,
      canOpenDetails: true,
      openFilePath: null,
      isPlan: false,
    });
  });

  it("keeps plan calls out of the expandable badge path", () => {
    const presentation = buildToolCallPresentation({
      toolName: "ExitPlanMode",
      status: "completed",
      error: null,
      detail: {
        type: "plan",
        text: "1. Do the thing",
      },
      resolveIcon: fakeResolveIcon,
    });

    expect(presentation.isPlan).toBe(true);
    expect(presentation.icon).toBe(fakeIcons.brain);
  });
});

it.each([
  ["message", "Message received"],
  ["finished", "Agent finished"],
  ["errored", "Agent errored"],
  ["permission-required", "Agent needs permission"],
  ["closed", "Agent closed"],
] as const)(
  "presents %s with a fixed label, the sender as context, and the Paseo icon",
  (event, heading) => {
    const presentation = buildToolCallPresentation({
      toolName: "internal_name_should_not_be_visible",
      status: "completed",
      error: null,
      detail: { type: "plain_text", label: "legacy summary", text: "legacy body", icon: "bot" },
      agentMessage: {
        event,
        sender: { id: "server::sender", title: "QA messenger" },
        text: "The delivered message.",
      },
      resolveIcon: fakeResolveIcon,
    });
    expect(presentation.displayName).toBe(heading);
    expect(presentation.summary).toBe("QA messenger");
    expect(presentation.icon).toBe(fakeIcons.paseo);
    expect(presentation.detail).toEqual({
      type: "plain_text",
      text: "From agent: server::sender\n\nThe delivered message.",
    });
  },
);

it("uses an opaque sender ID when no title is available", () => {
  const presentation = buildToolCallPresentation({
    toolName: "agent_message",
    status: "completed",
    error: null,
    agentMessage: { event: "message", sender: { id: "remote::worker" }, text: "Hello" },
    resolveIcon: fakeResolveIcon,
  });
  expect(presentation.displayName).toBe("Message received");
  expect(presentation.summary).toBe("remote::worker");
});

it("shows the target agent title as context for Paseo agent tools", () => {
  const presentation = buildToolCallPresentation({
    toolName: "mcp__paseo__kill_agent",
    status: "completed",
    error: null,
    detail: { type: "unknown", input: { agentId: "agt_1" }, output: null },
    targetAgentTitle: "Reviewer",
    resolveIcon: fakeResolveIcon,
  });
  expect(presentation.displayName).toBe("Kill agent");
  expect(presentation.summary).toBe("Reviewer");
});

describe("live view link of browser tool calls", () => {
  const browserId = "7c8fbc4a-4543-434c-834b-501864c533e5";
  const url = "http://127.0.0.1:18771/";
  const created = { ok: true, result: { command: "new_tab", browserId, url } };
  const createdText = `Created browser tab browserId=${browserId} url=${url}. Use this browserId for tab-scoped browser tools.`;

  function liveBrowserId(
    toolName: string,
    detail: { input: unknown; output: unknown },
    status: "running" | "completed" | "failed" | "canceled" = "completed",
  ) {
    return buildToolCallPresentation({
      toolName,
      status,
      error: status === "failed" ? "boom" : null,
      detail: { type: "unknown", ...detail },
      resolveIcon: fakeResolveIcon,
    }).liveBrowserId;
  }

  it.each([
    ["Claude", "mcp__paseo__browser_new_tab", { output: created }],
    ["Claude text", "mcp__paseo__browser_new_tab", { output: createdText }],
    [
      "Codex",
      "paseo.browser_new_tab",
      { content: [{ type: "text", text: createdText }], structuredContent: created },
    ],
    [
      "MCP text only",
      "paseo.browser_new_tab",
      { content: [{ type: "text", text: createdText }], structuredContent: null },
    ],
    ["OpenCode", "paseo_browser_new_tab", createdText],
  ])("links the tab that browser_new_tab created (%s)", (_provider, toolName, output) => {
    expect(liveBrowserId(toolName, { input: { url }, output })).toBe(browserId);
  });

  it("links a tab-scoped call by its input while it still runs", () => {
    const detail = { input: { browserId, ref: "@e3" }, output: null };
    expect(liveBrowserId("mcp__paseo__browser_click", detail, "running")).toBe(browserId);
  });

  it("does not link an error result that the provider reports as completed", () => {
    const output = {
      output: {
        ok: false,
        error: { code: "browser_timeout", message: `browser tab ${browserId} did not register` },
      },
    };
    expect(liveBrowserId("mcp__paseo__browser_new_tab", { input: { url }, output })).toBeNull();
  });

  it.each(["failed", "canceled"] as const)("does not link a %s call", (status) => {
    const detail = { input: { browserId }, output: null };
    expect(liveBrowserId("mcp__paseo__browser_reload", detail, status)).toBeNull();
  });

  it.each([
    ["a closed tab", "mcp__paseo__browser_close_tab", { browserId }],
    ["another MCP server", "mcp__playwright__browser_click", { browserId }],
    ["a malformed id", "mcp__paseo__browser_click", { browserId: "../settings" }],
    ["a new tab without a result yet", "mcp__paseo__browser_new_tab", { url }],
  ])("does not link %s", (_case, toolName, input) => {
    expect(liveBrowserId(toolName, { input, output: null })).toBeNull();
  });
});
