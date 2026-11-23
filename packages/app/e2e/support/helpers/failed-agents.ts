import { expect, type Page } from "@playwright/test";
import { closeCommandCenter, openCommandCenter } from "./command-center";
import { seedMockAgentWorkspace, type MockAgentWorkspace } from "./mock-agent";

export const NETWORK_ERROR =
  "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)";
export const USAGE_LIMIT_ERROR = "You've hit your limit · resets 5pm";

/** A mock agent whose first turn fails with `error`, as a provider reports it. */
export async function seedFailedAgent(input: {
  title: string;
  error: string;
}): Promise<MockAgentWorkspace> {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "failed-agent-",
    title: input.title,
    initialPrompt: `Emit a synthetic turn failure: ${input.error}`,
  });
  try {
    await agent.client.waitForAgentUpsert(agent.agentId, (s) => s.status === "error", 30_000);
    return agent;
  } catch (error) {
    await agent.cleanup();
    throw error;
  }
}

/** Archives the agents so later tests on this daemon don't see them as failed, then cleans up. */
export async function cleanupFailedAgents(agents: readonly MockAgentWorkspace[]): Promise<void> {
  await Promise.allSettled(
    agents.map(async (agent) => {
      await agent.client.archiveAgent(agent.agentId).catch(() => undefined);
      await agent.cleanup();
    }),
  );
}

export async function waitForAgentIdle(agent: MockAgentWorkspace): Promise<void> {
  await agent.client.waitForAgentUpsert(agent.agentId, (s) => s.status === "idle", 30_000);
}

export function failedAgentsCallout(page: Page) {
  return page.getByTestId("failed-agents-callout");
}

export function failedTurnPill(page: Page) {
  return page.getByTestId("composer-failed-turn-pill");
}

/** Opens the Failed pill's panel and checks it shows the error before retrying. */
export async function retryFailedTurnFromPill(page: Page, error: string): Promise<void> {
  await failedTurnPill(page).click();
  const retry = page.getByTestId("composer-failed-turn-retry");
  await expect(retry).toBeVisible();
  await expect(page.getByText(error, { exact: true }).last()).toBeVisible();
  await retry.click();
}

export async function expectRetryFailedAgentsInCommandCenter(
  page: Page,
  count: number,
): Promise<void> {
  const panel = await openCommandCenter(page);
  await page.keyboard.type("retry failed");
  await expect(panel.getByText(`Retry failed agents (${count})`)).toBeVisible();
  await closeCommandCenter(page);
}
