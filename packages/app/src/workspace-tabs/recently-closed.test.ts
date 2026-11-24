import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import {
  fetchRecentlyArchivedAgents,
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
    const { agents, hasMore } = selectRecentlyClosedAgents({
      workspaceId: "ws-1",
      fetched: [
        agent({ id: "old", archivedAt: OLDER }),
        agent({ id: "new", archivedAt: NEWER }),
        agent({ id: "active" }),
        agent({ id: "sub", archivedAt: NEWER, parentAgentId: "new" }),
        agent({ id: "elsewhere", archivedAt: NEWER, workspaceId: "ws-2" }),
      ],
      fetchedHasMore: false,
      live: undefined,
    });
    expect(agents.map((row) => row.id)).toEqual(["new", "old"]);
    expect(hasMore).toBe(false);
  });

  it("keeps only the newest few and says there are more", () => {
    const fetched = Array.from({ length: RECENTLY_CLOSED_LIMIT + 2 }, (_, index) =>
      agent({ id: `a${index}`, archivedAt: new Date(OLDER.getTime() + index * 1000) }),
    );
    const { agents, hasMore } = selectRecentlyClosedAgents({
      workspaceId: "ws-1",
      fetched,
      fetchedHasMore: false,
      live: undefined,
    });
    expect(agents).toHaveLength(RECENTLY_CLOSED_LIMIT);
    expect(agents[0]?.id).toBe(`a${RECENTLY_CLOSED_LIMIT + 1}`);
    expect(hasMore).toBe(true);
  });

  it("says there are more when the host has archived agents past the page", () => {
    const { hasMore } = selectRecentlyClosedAgents({
      workspaceId: "ws-1",
      fetched: [agent({ id: "a", archivedAt: OLDER })],
      fetchedHasMore: true,
      live: undefined,
    });
    expect(hasMore).toBe(true);
  });

  it("lets the live store drop an agent reopened since the fetch", () => {
    const { agents } = selectRecentlyClosedAgents({
      workspaceId: "ws-1",
      fetched: [agent({ id: "a", archivedAt: OLDER })],
      fetchedHasMore: false,
      live: [agent({ id: "a", archivedAt: null })],
    });
    expect(agents).toEqual([]);
  });

  it("adds an agent the live store saw archived after the fetch", () => {
    const { agents } = selectRecentlyClosedAgents({
      workspaceId: "ws-1",
      fetched: [],
      fetchedHasMore: false,
      live: [agent({ id: "a", archivedAt: NEWER }), agent({ id: "b", workspaceId: "ws-2" })],
    });
    expect(agents.map((row) => row.id)).toEqual(["a"]);
  });
});

describe("fetchRecentlyArchivedAgents", () => {
  it("asks for one bounded page of the workspace's archived agents, newest first", async () => {
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
    const client = {
      fetchAgentHistory: async (options: unknown) => {
        requests.push(options);
        return {
          entries: [entry("a"), entry("b")],
          pageInfo: { hasMore: true, nextCursor: "c1", prevCursor: null },
        };
      },
    } as unknown as Parameters<typeof fetchRecentlyArchivedAgents>[0]["client"];
    const result = await fetchRecentlyArchivedAgents({
      client,
      serverId: "s",
      workspaceId: "ws-1",
    });
    expect(requests).toEqual([
      {
        filter: { workspaceIds: ["ws-1"], includeArchived: true, archivedOnly: true },
        sort: [{ key: "updated_at", direction: "desc" }],
        page: { limit: 25 },
      },
    ]);
    expect(result.agents).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });
});
