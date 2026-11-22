import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";
import { BrowserAutomationBrowserIdSchema } from "@getpaseo/protocol/browser-automation/rpc-schemas";
import { paseoLeafName } from "@getpaseo/protocol/paseo-tool-presentation/index";
import { z } from "zod";

interface BrowserToolCall {
  name: string;
  status: "executing" | "running" | "completed" | "failed" | "canceled";
  detail: ToolCallDetail | undefined;
}

interface BrowserTabUse {
  browserId: string;
  closesTab: boolean;
}

const TabInputSchema = z.object({ browserId: BrowserAutomationBrowserIdSchema });
const ToolPayloadSchema = z.object({
  ok: z.boolean(),
  result: z.object({ browserId: z.string().optional() }).optional(),
});
// Codex and Pi keep the MCP result, Claude wraps the payload (or its text) in `output`,
// and OpenCode passes only the text.
const ToolOutputSchema = z.object({
  structuredContent: z.unknown().optional(),
  output: z.unknown().optional(),
  content: z.array(z.object({ text: z.string().optional() })).optional(),
});
const CREATED_TAB_TEXT = /^Created browser tab browserId=(\S+)/;

/** The tab to watch for these calls: the last one they used and did not close afterwards. */
export function findLiveBrowserId(calls: readonly BrowserToolCall[]): string | null {
  const closedIds = new Set<string>();
  // Indexed, not toReversed(): Hermes does not ship it.
  for (let index = calls.length - 1; index >= 0; index--) {
    const tab = readBrowserTabUse(calls[index]);
    if (!tab) continue;
    if (tab.closesTab) closedIds.add(tab.browserId);
    else if (!closedIds.has(tab.browserId)) return tab.browserId;
  }
  return null;
}

function readBrowserTabUse({ name, status, detail }: BrowserToolCall): BrowserTabUse | null {
  if (status === "failed" || status === "canceled" || detail?.type !== "unknown") return null;
  const tool = paseoLeafName(name);
  if (!tool?.startsWith("browser_")) return null;

  const { payload, text } = readOutput(detail.output);
  // A browser error reaches some providers as a completed call.
  if (payload?.ok === false) return null;

  const createdId = payload?.result?.browserId ?? text?.match(CREATED_TAB_TEXT)?.[1];
  const input = tool === "browser_new_tab" ? { browserId: createdId } : detail.input;
  const parsed = TabInputSchema.safeParse(input);
  if (!parsed.success) return null;
  return { browserId: parsed.data.browserId, closesTab: tool === "browser_close_tab" };
}

function readOutput(output: unknown) {
  if (typeof output === "string") return { payload: undefined, text: output };
  const wrapper = ToolOutputSchema.safeParse(output).data;
  const body = wrapper?.structuredContent ?? wrapper?.output;
  return {
    payload: ToolPayloadSchema.safeParse(body).data,
    text: typeof body === "string" ? body : wrapper?.content?.[0]?.text,
  };
}
