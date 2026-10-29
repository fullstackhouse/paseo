import { expect, test } from "vitest";

import type { AgentManagerEvent, AgentSubscriber } from "./agent-manager.js";
import type { CreatePaseoWorktreeInput } from "../paseo-worktree-service.js";
import {
  CreateAgentLifecycleDispatch,
  registerAgentAutoArchive,
} from "./create-agent-lifecycle-dispatch.js";

class AgentLifecycleEvents {
  private readonly listeners = new Set<AgentSubscriber>();

  subscribe(listener: AgentSubscriber): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  completeTurn(agentId: string): void {
    const event: AgentManagerEvent = {
      type: "agent_stream",
      agentId,
      event: { type: "turn_completed", provider: "codex" },
    };
    for (const listener of this.listeners) listener(event);
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

test("auto-archive self-releases once and later cancellation waits harmlessly", async () => {
  const agentId = "4a7e2521-286d-4ad5-af35-e091c55302e3";
  const agents = new AgentLifecycleEvents();
  let archiveCount = 0;
  const registration = registerAgentAutoArchive({
    agentManager: agents,
    agentId,
    archive: async () => {
      archiveCount += 1;
    },
  });

  agents.completeTurn(agentId);
  await registration.cancel();
  await registration.cancel();
  agents.completeTurn(agentId);

  expect(archiveCount).toBe(1);
  expect(agents.listenerCount()).toBe(0);
});

test("a checkout-pr target checks out the PR from its project", async () => {
  const placements: CreatePaseoWorktreeInput[] = [];
  const dispatch = new CreateAgentLifecycleDispatch({
    paseoHome: "/paseo-home",
    createPaseoWorktreeWorkflow: async (input: CreatePaseoWorktreeInput) => {
      placements.push(input);
      return null;
    },
  } as unknown as ConstructorParameters<typeof CreateAgentLifecycleDispatch>[0]);

  await dispatch.createWorktreeForRequest({
    cwd: "/repo",
    target: { mode: "checkout-pr", prNumber: 234, projectPath: "acme/app" },
    firstAgentContext: { prompt: "" },
  });

  expect(placements[0]?.checkoutSource).toEqual({
    kind: "change_request",
    number: 234,
    projectPath: "acme/app",
  });
});
