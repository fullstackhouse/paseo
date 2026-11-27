import { describe, expect, test } from "vitest";
import { buildAttachAgentContributions, canAttachAgent, listAttachTargets } from "./attach-agent";

function agent(
  id: string,
  overrides: Partial<{
    parentAgentId: string | null;
    workspaceId: string;
    archivedAt: Date | null;
    background: boolean;
    labels: Record<string, string>;
    lastActivityAt: Date;
    title: string | null;
  }> = {},
) {
  return {
    id,
    title: id,
    parentAgentId: null,
    workspaceId: "main",
    archivedAt: null,
    background: false,
    labels: {},
    lastActivityAt: new Date(0),
    ...overrides,
  };
}

describe("attach agent", () => {
  test("only a live root agent on this host can be attached", () => {
    expect(canAttachAgent(agent("root"))).toBe(true);
    expect(canAttachAgent(agent("child", { parentAgentId: "root" }))).toBe(false);
    expect(canAttachAgent(agent("old", { archivedAt: new Date() }))).toBe(false);
    expect(
      canAttachAgent(agent("remote-child", { labels: { "paseo.parent-server-id": "srv-2" } })),
    ).toBe(false);
  });

  test("lists other live agents, newest first, never the agent's own descendants", () => {
    const agents = new Map(
      [
        agent("self"),
        agent("older", { lastActivityAt: new Date(1) }),
        agent("newer", { lastActivityAt: new Date(2) }),
        agent("own-child", { parentAgentId: "self" }),
        agent("own-grandchild", { parentAgentId: "own-child" }),
        agent("archived", { archivedAt: new Date() }),
        agent("background", { background: true }),
      ].map((entry) => [entry.id, entry]),
    );

    expect(listAttachTargets(agents, "self").map((entry) => entry.id)).toEqual(["newer", "older"]);
  });

  test("builds one searchable choice per target, labelled with its workspace", async () => {
    const attached: string[] = [];
    const agents = new Map(
      [agent("self"), agent("orchestrator", { title: "Orchestrator", workspaceId: "ws-main" })].map(
        (entry) => [entry.id, entry],
      ),
    );

    const [contribution, ...rest] = buildAttachAgentContributions({
      agent: agents.get("self")!,
      agents,
      workspaceName: (workspaceId) => (workspaceId === "ws-main" ? "paseo" : null),
      labels: { group: "Attach to agent", keywords: "attach parent", untitled: "Untitled" },
      icon: () => null,
      attach: (parentAgentId) => {
        attached.push(parentAgentId);
      },
    });

    expect(rest).toEqual([]);
    expect(contribution?.presentation).toMatchObject({
      kind: "choice",
      path: ["Attach to agent", "Orchestrator · paseo"],
    });
    expect(contribution?.keywords).toEqual(["attach", "parent", "orchestrator", "paseo"]);
    await contribution?.run();
    expect(attached).toEqual(["orchestrator"]);
  });

  test("offers nothing for a subagent", () => {
    const agents = new Map(
      [agent("root"), agent("child", { parentAgentId: "root" })].map((entry) => [entry.id, entry]),
    );

    expect(
      buildAttachAgentContributions({
        agent: agents.get("child")!,
        agents,
        workspaceName: () => null,
        labels: { group: "Attach to agent", keywords: "attach", untitled: "Untitled" },
        icon: () => null,
        attach: () => undefined,
      }),
    ).toEqual([]);
  });
});
