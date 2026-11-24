import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import {
  fetchWorkspaceAgents,
  RECENTLY_CLOSED_LIMIT,
  selectRecentlyClosedAgents,
} from "./recently-closed";

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

describe("selectRecentlyClosedAgents", () => {
  it("lists this workspace's archived top-level agents, newest archive first", () => {
    const rows = selectRecentlyClosedAgents({
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

  it("keeps only the newest few", () => {
    const fetched = Array.from({ length: RECENTLY_CLOSED_LIMIT + 2 }, (_, index) =>
      agent({ id: `a${index}`, archivedAt: new Date(OLDER.getTime() + index * 1000) }),
    );
    const rows = selectRecentlyClosedAgents({ workspaceId: "ws-1", fetched, live: undefined });
    expect(rows).toHaveLength(RECENTLY_CLOSED_LIMIT);
    expect(rows[0]?.id).toBe(`a${RECENTLY_CLOSED_LIMIT + 1}`);
  });

  it("lets the live store drop an agent reopened since the fetch", () => {
    const rows = selectRecentlyClosedAgents({
      workspaceId: "ws-1",
      fetched: [agent({ id: "a", archivedAt: OLDER })],
      live: [agent({ id: "a", archivedAt: null })],
    });
    expect(rows).toEqual([]);
  });

  it("adds an agent the live store saw archived after the fetch", () => {
    const rows = selectRecentlyClosedAgents({
      workspaceId: "ws-1",
      fetched: [],
      live: [agent({ id: "a", archivedAt: NEWER }), agent({ id: "b", workspaceId: "ws-2" })],
    });
    expect(rows.map((row) => row.id)).toEqual(["a"]);
  });
});

describe("fetchWorkspaceAgents", () => {
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
    } as unknown as Parameters<typeof fetchWorkspaceAgents>[0]["client"];
    const agents = await fetchWorkspaceAgents({
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
