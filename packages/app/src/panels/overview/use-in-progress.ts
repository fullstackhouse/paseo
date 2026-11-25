import type { PaseoAgentBackgroundWorkItem as AgentBackgroundWorkItem } from "@getpaseo/client";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import equal from "fast-deep-equal";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { usePendingArchiveAgentKeys } from "@/hooks/use-archive-agent";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { refreshProviderSubagents, useProviderSubagentStore } from "@/subagents/provider-store";
import {
  createSubagentsForParentSelector,
  selectProviderSubagentsForParent,
  type SubagentRow,
} from "@/subagents/select";
import {
  buildSubagentPillPresentation,
  buildSubagentRowPresentationData,
  type SubagentPillPresentation,
} from "@/subagents/track-presentation";
import { isWorkspaceRootAgent } from "@/subagents/workspace-root-policy";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import type { InProgressAgent, InProgressJob } from "./model";

interface RootAgentFacts {
  agentId: string;
  running: boolean;
  lastActivityAt: number;
}

/**
 * The workspace's root agents, as one string: session selectors run on every store write, so the
 * selector returns a primitive and the list is parsed once per change.
 */
function selectRootAgentsKey(
  agents: ReadonlyMap<string, Agent> | undefined,
  workspaceId: string,
): string {
  if (!agents) return "";
  const target = normalizeWorkspaceOpaqueId(workspaceId);
  const lines: string[] = [];
  for (const agent of agents.values()) {
    if (agent.archivedAt || normalizeWorkspaceOpaqueId(agent.workspaceId) !== target) continue;
    const parent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (!isWorkspaceRootAgent(agent, parent)) continue;
    lines.push(
      `${agent.id}\t${agent.status === "running" ? 1 : 0}\t${agent.lastActivityAt.getTime()}`,
    );
  }
  return lines.sort().join("\n");
}

function parseRootAgents(key: string): RootAgentFacts[] {
  if (!key) return [];
  return key.split("\n").map((line) => {
    const [agentId = "", running, at] = line.split("\t");
    return { agentId, running: running === "1", lastActivityAt: Number(at) };
  });
}

const NO_ROWS: readonly SubagentRow[][] = [];

function sameRowLists(a: readonly SubagentRow[][], b: readonly SubagentRow[][]): boolean {
  return a.length === b.length && a.every((rows, index) => rows === b[index]);
}

/** Each root agent's subagents, as its track pill lists them. */
function useSubagentRowsByAgent(
  serverId: string,
  agentIds: readonly string[],
): readonly SubagentRow[][] {
  const pendingArchiveIds = usePendingArchiveAgentKeys();
  const idsKey = agentIds.join("\n");
  const selectPaseoRows = useMemo(() => {
    const ids = idsKey ? idsKey.split("\n") : [];
    const selectors = ids.map((parentAgentId) =>
      createSubagentsForParentSelector({ serverId, parentAgentId }, pendingArchiveIds),
    );
    return (state: Parameters<(typeof selectors)[number]>[0]) =>
      selectors.length === 0 ? NO_ROWS : selectors.map((select) => select(state));
  }, [idsKey, pendingArchiveIds, serverId]);
  const paseoRows = useStoreWithEqualityFn(useSessionStore, selectPaseoRows, sameRowLists);
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.providerSubagents === true,
  );
  const nestingSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.providerSubagentNesting === true,
  );
  const providerRows = useStoreWithEqualityFn(
    useProviderSubagentStore,
    (state) =>
      agentIds.map((parentAgentId) =>
        selectProviderSubagentsForParent(
          state,
          { serverId, parentAgentId },
          supported,
          nestingSupported,
        ),
      ),
    equal,
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  useEffect(() => {
    if (!client || !supported || !idsKey) return;
    for (const parentAgentId of idsKey.split("\n")) {
      void refreshProviderSubagents(client, serverId, parentAgentId).catch(() => undefined);
    }
  }, [client, idsKey, serverId, supported]);
  return useMemo(
    () => agentIds.map((_, index) => [...(paseoRows[index] ?? []), ...(providerRows[index] ?? [])]),
    [agentIds, paseoRows, providerRows],
  );
}

function toJob(item: AgentBackgroundWorkItem): InProgressJob {
  const startedAt = Date.parse(item.startedAt);
  return {
    id: item.id,
    kind: item.kind,
    description: item.description?.trim() || null,
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
  };
}

const NO_JOBS: readonly InProgressJob[] = [];

/**
 * The live background work (shells, monitors) of each agent in `agentIds`: listed once the update
 * feed is subscribed, then replaced by each update. Empty on hosts without `agentBackgroundWork`.
 */
function useBackgroundWork(
  serverId: string,
  agentIds: readonly string[],
): ReadonlyMap<string, readonly InProgressJob[]> {
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  // COMPAT(agentBackgroundWork): added after v0.11.0-beta.5, remove gate after 2027-04-06.
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentBackgroundWork === true,
  );
  const [work, setWork] = useState<ReadonlyMap<string, readonly InProgressJob[]>>(new Map());
  const idsKey = agentIds.join("\n");
  useEffect(() => {
    if (!client || !supported || !idsKey) return undefined;
    return watchBackgroundWork(client, idsKey.split("\n"), (agentId, items) =>
      setWork((current) => {
        const next = new Map(current);
        if (items.length > 0) next.set(agentId, items.map(toJob));
        else next.delete(agentId);
        return next;
      }),
    );
  }, [client, idsKey, supported]);
  return useMemo(() => {
    if (!supported) return new Map();
    return new Map(agentIds.map((id) => [id, work.get(id) ?? NO_JOBS]));
  }, [agentIds, supported, work]);
}

function watchBackgroundWork(
  client: DaemonClient,
  agentIds: readonly string[],
  onItems: (agentId: string, items: AgentBackgroundWorkItem[]) => void,
): () => void {
  const wanted = new Set(agentIds);
  // Bumped by every delivery per agent, so a list answered after a newer update is dropped.
  const sequence = new Map<string, number>();
  const bump = (agentId: string) => {
    const next = (sequence.get(agentId) ?? 0) + 1;
    sequence.set(agentId, next);
    return next;
  };
  let released = false;
  let observation: ReturnType<DaemonClient["observeAgentBackgroundWork"]>;
  try {
    observation = client.observeAgentBackgroundWork();
  } catch (error) {
    console.error("[Overview] Background work subscription failed", error);
    return () => undefined;
  }
  observation.subscribe({
    snapshot: () => {
      for (const agentId of agentIds) {
        const listed = bump(agentId);
        void client
          .listAgentBackgroundWork(agentId)
          .then((items) => {
            if (!released && sequence.get(agentId) === listed) onItems(agentId, items);
            return undefined;
          })
          .catch((error: unknown) => {
            if (!released) console.error("[Overview] Background work list failed", error);
          });
      }
    },
    update: (message) => {
      if (message.type !== "agent.background_work.update") return;
      if (!wanted.has(message.payload.agentId)) return;
      bump(message.payload.agentId);
      onItems(message.payload.agentId, message.payload.items);
    },
    error: (error) => {
      if (!released) console.error("[Overview] Background work subscription failed", error);
    },
  });
  return () => {
    released = true;
    void observation
      .release()
      .catch((error: unknown) =>
        console.error("[Overview] Background work subscription cleanup failed", error),
      );
  };
}

export interface SubagentLine {
  total: number;
  pill: SubagentPillPresentation;
}

export interface WorkspaceMovement {
  agents: InProgressAgent[];
  /** Each agent's subagents line: how many, and what its track pill says about them. */
  subagentLines: ReadonlyMap<string, SubagentLine>;
}

/**
 * What moves in the workspace besides plugins' entries: its root agents with their running turn,
 * subagents and background work, for `deriveInProgress`.
 */
export function useWorkspaceMovement(serverId: string, workspaceId: string): WorkspaceMovement {
  const { t } = useTranslation();
  const rootKey = useSessionStore((state) =>
    selectRootAgentsKey(state.sessions[serverId]?.agents, workspaceId),
  );
  const roots = useMemo(() => parseRootAgents(rootKey), [rootKey]);
  const agentIds = useMemo(() => roots.map((root) => root.agentId), [roots]);
  const subagentRows = useSubagentRowsByAgent(serverId, agentIds);
  const work = useBackgroundWork(serverId, agentIds);
  return useMemo(() => {
    const subagentLines = new Map<string, SubagentLine>();
    const agents = roots.map((root, index): InProgressAgent => {
      const rows = subagentRows[index] ?? [];
      const pill = rows.length > 0 ? buildSubagentPillPresentation(t, rows) : null;
      const subagentsActive = Boolean(pill?.segments.some((segment) => segment.bucket !== null));
      if (pill && subagentsActive) subagentLines.set(root.agentId, { total: rows.length, pill });
      return {
        ...root,
        subagentsRunning: rows.some(
          (row) => buildSubagentRowPresentationData(row).statusBucket === "running",
        ),
        subagentsActive,
        jobs: work.get(root.agentId) ?? NO_JOBS,
      };
    });
    return { agents, subagentLines };
  }, [roots, subagentRows, t, work]);
}

/** A timestamp that moves on once a minute, for flags that turn on after a while. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}
