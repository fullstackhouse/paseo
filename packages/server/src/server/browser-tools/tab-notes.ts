/**
 * What the user did with a tab, kept for the agents that use it until their next browser call.
 * Delivering on that call, and never as a prompt, is what keeps hand-back from waking an agent.
 */
export class BrowserTabNotes {
  private readonly agentsByBrowserId = new Map<string, Set<string>>();
  private readonly notesByAgentId = new Map<string, Map<string, string>>();
  /** For tabs this daemon saw no agent use, as after a restart. */
  private readonly notesForNextCaller = new Map<string, string>();

  public recordUse(browserId: string, agentId: string): void {
    const agents = this.agentsByBrowserId.get(browserId) ?? new Set<string>();
    agents.add(agentId);
    this.agentsByBrowserId.set(browserId, agents);
  }

  /** Returns the agents the note waits for. */
  public add(browserId: string, note: string): string[] {
    const agentIds = [...(this.agentsByBrowserId.get(browserId) ?? [])];
    if (agentIds.length === 0) this.notesForNextCaller.set(browserId, note);
    for (const agentId of agentIds) {
      const notes = this.notesByAgentId.get(agentId) ?? new Map<string, string>();
      notes.set(browserId, note);
      this.notesByAgentId.set(agentId, notes);
    }
    return agentIds;
  }

  /** Drops notes a new hold of the tab made stale. */
  public discard(browserId: string): void {
    this.notesForNextCaller.delete(browserId);
    for (const notes of this.notesByAgentId.values()) notes.delete(browserId);
  }

  public deliver(agentId: string, browserId: string | null): string[] {
    const notes = [...(this.notesByAgentId.get(agentId)?.values() ?? [])];
    this.notesByAgentId.delete(agentId);
    if (!browserId) return notes;
    const unclaimed = this.notesForNextCaller.get(browserId);
    if (unclaimed === undefined) return notes;
    this.notesForNextCaller.delete(browserId);
    return [...notes, unclaimed];
  }
}
