import { describe, expect, it } from "vitest";
import type { AttentionItem } from "@/workspace-attention/model";
import { deriveOverviewNextStep } from "./next-step";

const permission: AttentionItem = { kind: "permission", key: "permission:a:p", agentId: "a" };
const failed: AttentionItem = { kind: "failed", key: "failed:a", agentId: "a" };
const checks: AttentionItem = { kind: "pr-checks-failed", key: "pr-checks-failed:7:e2e" };
const merged: AttentionItem = { kind: "pr-merged", key: "pr-merged:7" };

describe("deriveOverviewNextStep", () => {
  it("puts what blocks on you first, even while an agent runs", () => {
    expect(deriveOverviewNextStep({ items: [checks, permission], agentRunning: true })).toEqual({
      kind: "attention",
      item: permission,
    });
    expect(deriveOverviewNextStep({ items: [failed], agentRunning: false })).toEqual({
      kind: "attention",
      item: failed,
    });
  });

  it("offers nothing while an agent is running", () => {
    expect(deriveOverviewNextStep({ items: [checks], agentRunning: true })).toEqual({
      kind: "working",
    });
  });

  it("sends failing checks to the pull request, then falls back to the git action", () => {
    expect(deriveOverviewNextStep({ items: [checks], agentRunning: false })).toEqual({
      kind: "attention",
      item: checks,
    });
    expect(deriveOverviewNextStep({ items: [merged], agentRunning: false })).toEqual({
      kind: "git",
    });
    expect(deriveOverviewNextStep({ items: [], agentRunning: false })).toEqual({ kind: "git" });
  });
});
