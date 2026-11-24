import type { Agent } from "@/stores/session-store";

interface AttentionState {
  focused: boolean;
  ready: boolean;
  requiresAttention: boolean;
  attentionReason: "finished" | "error" | "permission" | null | undefined;
  focusRequest: object | null;
}

export function createAgentAttentionController(deps: {
  clear: () => Promise<void>;
  onError: (error: unknown) => void;
}) {
  let state: AttentionState | null = null;
  let inFlight = false;
  let pendingFocus = false;

  function acknowledgeFocus() {
    if (!pendingFocus || !state?.focused || !state.ready) return;
    pendingFocus = false;
    if (!state.requiresAttention || state.attentionReason === "permission" || inFlight) return;
    // FSH: viewing a finished agent is not reviewing it. "Ready to review" stays until the next
    // prompt or an explicit Move to Done (Mark as read on older hosts) in the workspace menu.
    if (state.attentionReason === "finished") return;
    inFlight = true;
    void deps.clear().then(
      () => {
        inFlight = false;
        return undefined;
      },
      (error: unknown) => {
        inFlight = false;
        deps.onError(error);
      },
    );
  }

  return {
    focus() {
      if (!state?.focused) return;
      pendingFocus = true;
      acknowledgeFocus();
    },
    update(next: AttentionState) {
      const entered = next.focused && !state?.focused;
      const requested = next.focusRequest !== null && next.focusRequest !== state?.focusRequest;
      state = { ...next };
      if (!next.focused) pendingFocus = false;
      else if (entered || requested) pendingFocus = true;
      acknowledgeFocus();
    },
  };
}

// FSH: only agents that need an action take focus. "Ready to review" (finished) stays after a
// visit here, so counting it made every entry land on the oldest finished agent instead of the
// tab you left.
const ATTENTION_REASON_PRIORITY: Partial<Record<NonNullable<Agent["attentionReason"]>, number>> = {
  permission: 0,
  error: 1,
};

function getAttentionPriority(reason: Agent["attentionReason"]): number | null {
  if (!reason) {
    return null;
  }
  return ATTENTION_REASON_PRIORITY[reason] ?? null;
}

export function pickAttentionAgent(agents: Agent[]): string | null {
  let selectedAgentId: string | null = null;
  let selectedPriority = Number.POSITIVE_INFINITY;
  let selectedTimestamp = Number.POSITIVE_INFINITY;

  for (const agent of agents) {
    if (agent.requiresAttention !== true) {
      continue;
    }

    if (agent.parentAgentId) {
      continue;
    }

    const priority = getAttentionPriority(agent.attentionReason);
    if (priority === null) {
      continue;
    }

    const timestamp = agent.attentionTimestamp?.getTime() ?? Number.POSITIVE_INFINITY;
    const isHigherPriority = priority < selectedPriority;
    const isOlderAtSamePriority = priority === selectedPriority && timestamp < selectedTimestamp;
    if (isHigherPriority || isOlderAtSamePriority) {
      selectedAgentId = agent.id;
      selectedPriority = priority;
      selectedTimestamp = timestamp;
    }
  }

  return selectedAgentId;
}
