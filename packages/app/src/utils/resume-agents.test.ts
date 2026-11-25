import { describe, expect, it } from "vitest";
import { formatUnreachedMessage, resumeAgentsWith, type ResumeClient } from "./resume-agents";

interface Sent {
  agentId: string;
  text: string;
  keepSnoozed: boolean | undefined;
}

function fakeClient(input: { rejects?: readonly string[]; resumePrompt?: string } = {}) {
  const sent: Sent[] = [];
  const client = {
    getDaemonConfig: async () => ({ config: { resumePrompt: input.resumePrompt } }),
    sendAgentMessage: async (
      agentId: string,
      text: string,
      options?: { keepSnoozed?: boolean },
    ) => {
      if (input.rejects?.includes(agentId)) throw new Error("agent not found");
      sent.push({ agentId, text, keepSnoozed: options?.keepSnoozed });
      return {};
    },
  };
  // Only the two methods resuming uses; the rest of the client is never touched.
  return { sent, client: client as unknown as ResumeClient };
}

describe("resumeAgentsWith", () => {
  it("sends each agent its host's resume prompt and reports none unreached", async () => {
    const one = fakeClient({ resumePrompt: "keep going" });
    const two = fakeClient({ resumePrompt: "carry on" });
    const clients: Record<string, ResumeClient> = {
      one: one.client,
      two: two.client,
    };

    const unreached = await resumeAgentsWith(
      [
        { serverId: "one", id: "a" },
        { serverId: "two", id: "b" },
        { serverId: "one", id: "c" },
      ],
      (serverId) => clients[serverId] ?? null,
    );

    expect(unreached).toEqual([]);
    expect(one.sent).toEqual([
      { agentId: "a", text: "keep going", keepSnoozed: true },
      { agentId: "c", text: "keep going", keepSnoozed: true },
    ]);
    expect(two.sent).toEqual([{ agentId: "b", text: "carry on", keepSnoozed: true }]);
  });

  it("reports agents whose host has no client and agents whose send failed", async () => {
    const connected = fakeClient({ rejects: ["refused"] });
    const unreached = await resumeAgentsWith(
      [
        { serverId: "connected", id: "ok" },
        { serverId: "connected", id: "refused" },
        { serverId: "offline", id: "away" },
      ],
      (serverId) => (serverId === "connected" ? connected.client : null),
    );

    expect(unreached.map((agent) => agent.id).sort()).toEqual(["away", "refused"]);
    expect(connected.sent.map((sent) => sent.agentId)).toEqual(["ok"]);
  });
});

describe("formatUnreachedMessage", () => {
  it("says nothing when every agent was reached", () => {
    expect(formatUnreachedMessage([])).toBeNull();
  });

  it("names the agents a resume couldn't reach", () => {
    expect(formatUnreachedMessage(["Fix login"])).toBe("1 agent wasn't restarted: Fix login");
    expect(formatUnreachedMessage(["Fix login", null])).toBe(
      "2 agents weren't restarted: Fix login, Untitled agent",
    );
  });

  it("names the first three and counts the rest", () => {
    expect(formatUnreachedMessage(["a", "b", "c", "d", "e"])).toBe(
      "5 agents weren't restarted: a, b, c, +2 more",
    );
  });
});
