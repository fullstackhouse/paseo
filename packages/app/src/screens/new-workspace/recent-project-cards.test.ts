import { describe, expect, it } from "vitest";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { summarizeAgentSetup } from "./recent-project-cards";

function provider(id: string, label: string, models: Array<{ id: string; label: string }>) {
  return {
    provider: id,
    status: "ready",
    enabled: true,
    label,
    models: models.map((model) => ({ provider: id, ...model })),
    modes: [{ id: "auto", label: "Auto" }],
  } as ProviderSnapshotEntry;
}

const claude = provider("claude", "Claude", [{ id: "claude-opus-5-5", label: "Opus 5.5" }]);
const cloud = provider("paseo-claude-cloud", "Claude (cloud)", [
  { id: "claude-opus-5-5", label: "Opus 5.5" },
]);
const codex = provider("codex", "Codex", [{ id: "gpt-6", label: "GPT-6" }]);

function setup(providerId: string, modelId: string) {
  return { provider: providerId, modelId, modeId: "auto", thinkingOptionId: "", options: {} };
}

describe("summarizeAgentSetup", () => {
  it("leaves the provider out when only its provider offers the model", () => {
    expect(summarizeAgentSetup(setup("claude", "claude-opus-5-5"), [claude, codex])).toBe(
      "Opus 5.5 · Auto",
    );
  });

  it("names the provider when another provider offers the same model", () => {
    const entries = [claude, cloud, codex];
    expect(summarizeAgentSetup(setup("claude", "claude-opus-5-5"), entries)).toBe(
      "Claude · Opus 5.5 · Auto",
    );
    expect(summarizeAgentSetup(setup("paseo-claude-cloud", "claude-opus-5-5"), entries)).toBe(
      "Claude (cloud) · Opus 5.5 · Auto",
    );
  });
});
