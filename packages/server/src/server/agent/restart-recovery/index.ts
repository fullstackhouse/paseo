import type { AgentStorage, StoredAgentRecord } from "../agent-storage.js";
interface Dependencies {
  storage: AgentStorage;
  settings(): { enabled: boolean; prompt: string };
  eligible(record: StoredAgentRecord): Promise<boolean>;
  dispatch(agentId: string, prompt: string): Promise<unknown>;
  report(agentId: string, error: unknown): void;
  /**
   * FSH fork: what dies with the agent's provider process (running subagents, background shells,
   * monitors), one label each. An idle agent waiting on it counts as interrupted too.
   */
  liveWork?(agentId: string): string[];
}

/** FSH fork: tells a resumed agent which background work the restart stopped. */
export function describeInterruptedWork(prompt: string, work: readonly string[]): string {
  if (work.length === 0) return prompt;
  return [
    prompt,
    "",
    "The Paseo daemon restarted and stopped this background work before it finished:",
    ...work.map((label) => `- ${label}`),
    "Check what each one left behind and restart whatever is unfinished.",
  ].join("\n");
}
export function createRestartRecovery(deps: Dependencies) {
  // Candidates are chosen at startup; each settles once its resume was sent or abandoned.
  const resuming = new Map<string, { promise: Promise<void>; resolve(): void }>();
  const eligible = async (record: StoredAgentRecord) =>
    !record.archivedAt && !record.internal && !record.owner && (await deps.eligible(record));
  // FSH fork: interruptedAt feeds the app's Resume all callout, so only agents the daemon
  // won't resume itself get it. An automatic restart (e.g. an update) then asks nothing.
  async function markInterrupted(agentId: string) {
    const record = await deps.storage.get(agentId);
    if (record && !record.interruptedAt)
      await deps.storage.upsert({ ...record, interruptedAt: new Date().toISOString() });
  }
  async function resume(agentId: string) {
    const record = await deps.storage.get(agentId);
    if (!record?.resumeOnStartup) return;
    await deps.storage.upsert({ ...record, resumeOnStartup: false, interruptedWork: undefined });
    if (!(await eligible(record))) return;
    if (!deps.settings().enabled) return markInterrupted(agentId);
    try {
      await deps.dispatch(
        agentId,
        describeInterruptedWork(deps.settings().prompt, record.interruptedWork ?? []),
      );
    } catch (error) {
      await markInterrupted(agentId);
      throw error;
    }
  }
  return {
    /** Choose candidates before anything else reads or repairs persisted running status. */
    async prepareStartup() {
      const now = new Date().toISOString();
      for (const record of await deps.storage.list()) {
        const candidate =
          (record.resumeOnStartup === true || record.lastStatus === "running") &&
          (await eligible(record));
        const pending = deps.settings().enabled && candidate;
        // FSH fork: a candidate that won't be resumed is offered in the Resume all callout.
        const unresumed = candidate && !pending;
        await deps.storage.upsert({
          ...record,
          ...(unresumed && !record.interruptedAt ? { interruptedAt: now } : {}),
          resumeOnStartup: pending,
          lastStatus:
            record.lastStatus === "running" || record.lastStatus === "initializing"
              ? "closed"
              : record.lastStatus,
        });
        if (pending) {
          let resolve!: () => void;
          const promise = new Promise<void>((settle) => {
            resolve = settle;
          });
          resuming.set(record.id, { promise, resolve });
        }
      }
    },
    async captureRunningAgents() {
      await deps.storage.flush();
      const interruptedAt = new Date().toISOString();
      const enabled = deps.settings().enabled;
      for (const record of await deps.storage.list()) {
        // FSH fork: an idle agent waiting on background work loses it too.
        const work = deps.liveWork?.(record.id) ?? [];
        if ((record.lastStatus === "running" || work.length > 0) && (await eligible(record)))
          await deps.storage.upsert({
            ...record,
            resumeOnStartup: enabled,
            ...(work.length > 0 ? { interruptedWork: work } : {}),
            ...(enabled ? {} : { interruptedAt }),
          });
      }
    },
    /** Resume every candidate in the background; a slow provider holds back only its agent. */
    resumePending() {
      for (const [agentId, settled] of resuming) {
        void resume(agentId)
          .catch((error) => deps.report(agentId, error))
          .finally(() => {
            resuming.delete(agentId);
            settled.resolve();
          });
      }
    },
    /** Wait until this agent's resume was sent or abandoned. Others return at once. */
    async waitForResume(agentId: string, signal: AbortSignal) {
      const settled = resuming.get(agentId);
      if (!settled) return;
      let abort!: () => void;
      const aborted = new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason);
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
      try {
        await Promise.race([settled.promise, aborted]);
      } finally {
        signal.removeEventListener("abort", abort);
      }
    },
  };
}
