import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { afterEach, describe, expect, it } from "vitest";
import { useSessionStore, type Agent } from "@/stores/session-store";
import {
  createLineageSelector,
  deriveLineage,
  lineageCrossesWorkspace,
  MAX_LINEAGE_DEPTH,
} from "./lineage";

const SERVER_ID = "server-1";
const OTHER_SERVER_ID = "server-2";
const AGENT_TIMESTAMP = new Date("2026-03-08T10:00:00.000Z");

const AGENT_DEFAULTS: Agent = {
  serverId: SERVER_ID,
  id: "agent",
  provider: "codex",
  status: "idle",
  turn: { phase: "idle", cancellationRequestId: null },
  createdAt: AGENT_TIMESTAMP,
  updatedAt: AGENT_TIMESTAMP,
  lastUserMessageAt: null,
  lastActivityAt: AGENT_TIMESTAMP,
  capabilities: {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: true,
    supportsMcpServers: true,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
  },
  currentModeId: null,
  availableModes: [],
  pendingPermissions: [],
  persistence: null,
  runtimeInfo: undefined,
  lastUsage: undefined,
  lastError: null,
  title: "Agent",
  cwd: "/tmp/project",
  model: null,
  features: undefined,
  thinkingOptionId: undefined,
  requiresAttention: false,
  attentionReason: null,
  attentionTimestamp: null,
  archivedAt: null,
  parentAgentId: null,
  labels: {},
  projectPlacement: null,
};

function makeAgent(input: Partial<Agent> & Pick<Agent, "id">): Agent {
  return {
    ...AGENT_DEFAULTS,
    ...input,
    labels: {
      ...(input.parentAgentId ? { "paseo.parent-agent-id": input.parentAgentId } : {}),
      ...input.labels,
    },
  };
}

function setAgents(serverId: string, agents: Agent[]): void {
  useSessionStore.getState().initializeSession(serverId, null as unknown as DaemonClient);
  useSessionStore
    .getState()
    .setAgents(serverId, new Map(agents.map((agent) => [agent.id, { ...agent, serverId }])));
}

function at(agentId: string, serverId = SERVER_ID) {
  return { serverId, agentId };
}

afterEach(() => {
  useSessionStore.getState().clearSession(SERVER_ID);
  useSessionStore.getState().clearSession(OTHER_SERVER_ID);
});

describe("deriveLineage", () => {
  it("lists ancestors root first and children oldest first", () => {
    setAgents(SERVER_ID, [
      makeAgent({ id: "root", workspaceId: "ws-a" }),
      makeAgent({ id: "parent", parentAgentId: "root", workspaceId: "ws-a" }),
      makeAgent({ id: "focus", parentAgentId: "parent", workspaceId: "ws-b" }),
      makeAgent({
        id: "late-child",
        parentAgentId: "focus",
        workspaceId: "ws-c",
        createdAt: new Date("2026-03-08T12:00:00.000Z"),
      }),
      makeAgent({
        id: "early-child",
        parentAgentId: "focus",
        workspaceId: "ws-b",
        createdAt: new Date("2026-03-08T11:00:00.000Z"),
      }),
      makeAgent({ id: "grandchild", parentAgentId: "early-child", workspaceId: "ws-b" }),
    ]);

    const lineage = deriveLineage(useSessionStore.getState(), at("focus"));

    expect(lineage.ancestors.map((node) => node.address.agentId)).toEqual(["root", "parent"]);
    expect(lineage.children.map((node) => node.address.agentId)).toEqual([
      "early-child",
      "late-child",
    ]);
    expect(lineage.children[1]).toMatchObject({ workspaceId: "ws-c", missing: false });
  });

  it("keeps a parent the client hasn't loaded as a missing node", () => {
    setAgents(SERVER_ID, [makeAgent({ id: "focus", parentAgentId: "gone", workspaceId: "ws-a" })]);

    const lineage = deriveLineage(useSessionStore.getState(), at("focus"));

    expect(lineage.ancestors).toEqual([
      { address: at("gone"), workspaceId: null, archived: false, missing: true, detached: false },
    ]);
  });

  it("marks an archived parent and leaves archived children out", () => {
    setAgents(SERVER_ID, [
      makeAgent({ id: "parent", workspaceId: "ws-a", archivedAt: AGENT_TIMESTAMP }),
      makeAgent({ id: "focus", parentAgentId: "parent", workspaceId: "ws-a" }),
      makeAgent({
        id: "archived-child",
        parentAgentId: "focus",
        workspaceId: "ws-a",
        archivedAt: AGENT_TIMESTAMP,
      }),
    ]);

    const lineage = deriveLineage(useSessionStore.getState(), at("focus"));

    expect(lineage.ancestors).toEqual([expect.objectContaining({ archived: true })]);
    expect(lineage.children).toEqual([]);
  });

  it("follows a parent on another host", () => {
    setAgents(OTHER_SERVER_ID, [makeAgent({ id: "remote-parent", workspaceId: "ws-r" })]);
    setAgents(SERVER_ID, [
      makeAgent({
        id: "focus",
        workspaceId: "ws-a",
        labels: {
          "paseo.parent-agent-id": "remote-parent",
          "paseo.parent-server-id": OTHER_SERVER_ID,
        },
      }),
    ]);

    const lineage = deriveLineage(useSessionStore.getState(), at("focus"));

    expect(lineage.ancestors).toEqual([
      expect.objectContaining({ address: at("remote-parent", OTHER_SERVER_ID), missing: false }),
    ]);
  });

  it("stops at a cycle in parent labels", () => {
    setAgents(SERVER_ID, [
      makeAgent({ id: "a", parentAgentId: "b", workspaceId: "ws-a" }),
      makeAgent({ id: "b", parentAgentId: "a", workspaceId: "ws-a" }),
    ]);

    const lineage = deriveLineage(useSessionStore.getState(), at("a"));

    expect(lineage.ancestors.map((node) => node.address.agentId)).toEqual(["b"]);
  });

  it("caps a very deep chain", () => {
    const agents = Array.from({ length: MAX_LINEAGE_DEPTH + 5 }, (_, index) =>
      makeAgent({
        id: `agent-${index}`,
        parentAgentId: index === 0 ? null : `agent-${index - 1}`,
        workspaceId: "ws-a",
      }),
    );
    setAgents(SERVER_ID, agents);

    const lineage = deriveLineage(useSessionStore.getState(), at(`agent-${agents.length - 1}`));

    expect(lineage.ancestors).toHaveLength(MAX_LINEAGE_DEPTH);
  });
});

describe("deriveLineage after detach", () => {
  it("keeps the former parent as a detached ancestor and keeps walking above it", () => {
    setAgents(SERVER_ID, [
      makeAgent({ id: "root", workspaceId: "ws-a" }),
      makeAgent({ id: "former-parent", parentAgentId: "root", workspaceId: "ws-a" }),
      makeAgent({
        id: "focus",
        workspaceId: "ws-b",
        labels: { "paseo.detached-from": "former-parent" },
      }),
    ]);

    const lineage = deriveLineage(useSessionStore.getState(), at("focus"));

    expect(lineage.ancestors).toEqual([
      expect.objectContaining({ address: at("root"), detached: false }),
      expect.objectContaining({ address: at("former-parent"), detached: true }),
    ]);
  });

  it("lists a detached former child, marked detached", () => {
    setAgents(SERVER_ID, [
      makeAgent({ id: "focus", workspaceId: "ws-a" }),
      makeAgent({ id: "child", parentAgentId: "focus", workspaceId: "ws-a" }),
      makeAgent({
        id: "detached-child",
        workspaceId: "ws-b",
        labels: { "paseo.detached-from": "focus" },
      }),
    ]);

    const lineage = deriveLineage(useSessionStore.getState(), at("focus"));

    expect(lineage.children).toEqual([
      expect.objectContaining({ address: at("child"), detached: false }),
      expect.objectContaining({ address: at("detached-child"), detached: true }),
    ]);
  });

  it("follows a detached-from host label", () => {
    setAgents(OTHER_SERVER_ID, [makeAgent({ id: "remote-parent", workspaceId: "ws-r" })]);
    setAgents(SERVER_ID, [
      makeAgent({
        id: "focus",
        workspaceId: "ws-a",
        labels: {
          "paseo.detached-from": "remote-parent",
          "paseo.detached-from-server-id": OTHER_SERVER_ID,
        },
      }),
    ]);

    const lineage = deriveLineage(useSessionStore.getState(), at("focus"));

    expect(lineage.ancestors).toEqual([
      expect.objectContaining({ address: at("remote-parent", OTHER_SERVER_ID), detached: true }),
    ]);
  });
});

describe("lineageCrossesWorkspace", () => {
  it("is true only when a loaded relative runs elsewhere", () => {
    setAgents(SERVER_ID, [
      makeAgent({ id: "focus", parentAgentId: "gone", workspaceId: "ws-a" }),
      makeAgent({ id: "same", parentAgentId: "focus", workspaceId: "ws-a" }),
    ]);
    const workspace = { serverId: SERVER_ID, workspaceId: "ws-a" };
    expect(
      lineageCrossesWorkspace(deriveLineage(useSessionStore.getState(), at("focus")), workspace),
    ).toBe(false);

    setAgents(SERVER_ID, [
      makeAgent({ id: "focus", workspaceId: "ws-a" }),
      makeAgent({ id: "elsewhere", parentAgentId: "focus", workspaceId: "ws-b" }),
    ]);
    expect(
      lineageCrossesWorkspace(deriveLineage(useSessionStore.getState(), at("focus")), workspace),
    ).toBe(true);
  });
});

describe("createLineageSelector", () => {
  it("returns the same object until an agent map changes the result", () => {
    setAgents(SERVER_ID, [
      makeAgent({ id: "focus", workspaceId: "ws-a" }),
      makeAgent({ id: "child", parentAgentId: "focus", workspaceId: "ws-b" }),
    ]);
    const select = createLineageSelector(at("focus"));
    const first = select(useSessionStore.getState());

    setAgents(SERVER_ID, [
      makeAgent({ id: "focus", workspaceId: "ws-a", title: "Renamed" }),
      makeAgent({ id: "child", parentAgentId: "focus", workspaceId: "ws-b" }),
    ]);
    expect(select(useSessionStore.getState())).toBe(first);
  });
});
