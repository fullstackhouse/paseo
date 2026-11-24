import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import { fetchWorkspaceArchivedAgents, selectArchivedAgentRows } from "./archived-agents";

function agent(input: Partial<Agent> & Pick<Agent, "id">): Agent {
  return {
    title: input.id,
    provider: "claude",
    workspaceId: "ws-1",
    archivedAt: null,
    parentAgentId: null,
    ...input,
  } as Agent;
}

const OLDER = new Date("2026-11-20T10:00:00.000Z");
const NEWER = new Date("2026-11-23T10:00:00.000Z");

describe("selectArchivedAgentRows", () => {
  it("lists this workspace's archived top-level agents, newest archive first", () => {
    const rows = selectArchivedAgentRows({
      workspaceId: "ws-1",
      fetched: [
        agent({ id: "old", archivedAt: OLDER }),
        agent({ id: "new", archivedAt: NEWER }),
        agent({ id: "active" }),
        agent({ id: "sub", archivedAt: NEWER, parentAgentId: "new" }),
        agent({ id: "elsewhere", archivedAt: NEWER, workspaceId: "ws-2" }),
      ],
      live: undefined,
    });
    expect(rows.map((row) => row.id)).toEqual(["new", "old"]);
  });

  it("lets the live store drop an agent unarchived since the fetch", () => {
    const rows = selectArchivedAgentRows({
      workspaceId: "ws-1",
      fetched: [agent({ id: "a", archivedAt: OLDER })],
      live: [agent({ id: "a", archivedAt: null })],
    });
    expect(rows).toEqual([]);
  });

  it("adds an agent the live store saw archived after the fetch", () => {
    const rows = selectArchivedAgentRows({
      workspaceId: "ws-1",
      fetched: [],
      live: [agent({ id: "a", archivedAt: NEWER }), agent({ id: "b", workspaceId: "ws-2" })],
    });
    expect(rows.map((row) => row.id)).toEqual(["a"]);
  });
});

describe("fetchWorkspaceArchivedAgents", () => {
  it("asks for one workspace's agents, archived included, across every page", async () => {
    const requests: unknown[] = [];
    const entry = (id: string) => ({
      agent: {
        id,
        workspaceId: "ws-1",
        provider: "claude",
        status: "closed",
        createdAt: OLDER.toISOString(),
        updatedAt: OLDER.toISOString(),
        lastUserMessageAt: null,
        capabilities: {
          supportsStreaming: true,
          supportsSessionPersistence: true,
          supportsDynamicModes: false,
          supportsMcpServers: false,
          supportsReasoningStream: false,
          supportsToolInvocations: true,
        },
        currentModeId: null,
        availableModes: [],
        pendingPermissions: [],
        persistence: null,
        title: id,
        cwd: "/repo",
        model: null,
        archivedAt: OLDER.toISOString(),
        labels: {},
      },
      project: null,
    });
    const pages = [
      { entries: [entry("a")], pageInfo: { hasMore: true, nextCursor: "c1", prevCursor: null } },
      { entries: [entry("b")], pageInfo: { hasMore: false, nextCursor: null, prevCursor: "c1" } },
    ];
    const client = {
      fetchAgentHistory: async (options: unknown) => {
        requests.push(options);
        return pages[requests.length - 1];
      },
    } as unknown as Parameters<typeof fetchWorkspaceArchivedAgents>[0]["client"];
    const agents = await fetchWorkspaceArchivedAgents({
      client,
      serverId: "s",
      workspaceId: "ws-1",
    });
    expect(requests).toEqual([
      expect.objectContaining({
        filter: { workspaceIds: ["ws-1"], includeArchived: true },
        page: { limit: 200 },
      }),
      expect.objectContaining({ page: { limit: 200, cursor: "c1" } }),
    ]);
    expect(agents).toHaveLength(2);
  });
});
