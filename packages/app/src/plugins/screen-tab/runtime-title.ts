import type { PluginScreenRuntimeTitle } from "@getpaseo/plugin/client";
import type { JsonValue } from "@getpaseo/protocol/agent-types";

/** The title a screen set with `setTitle`, read back from its tab's persisted state. */
export function readPluginScreenTabTitle(
  state: JsonValue | undefined,
): Required<PluginScreenRuntimeTitle> | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const title = state.title;
  if (!title || typeof title !== "object" || Array.isArray(title)) return null;
  const label = typeof title.label === "string" ? title.label.trim() : "";
  if (!label) return null;
  const tooltip = typeof title.tooltip === "string" ? title.tooltip.trim() : "";
  return { label, tooltip: tooltip || label };
}

/** The tab state that stores `title`, or null when it is already stored. */
export function nextPluginScreenTabState(
  state: JsonValue | undefined,
  title: PluginScreenRuntimeTitle | null,
): JsonValue | null {
  const current = readPluginScreenTabTitle(state);
  const label = title?.label.trim() ?? "";
  if (!label) return current ? {} : null;
  const tooltip = title?.tooltip?.trim() || label;
  if (current?.label === label && current.tooltip === tooltip) return null;
  return { title: { label, tooltip } };
}
