import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  NETWORK_ERROR,
  USAGE_LIMIT_ERROR,
  cleanupFailedAgents,
  expectRetryFailedAgentsInCommandCenter,
  failedAgentsCallout,
  failedTurnPill,
  retryFailedAgentsFromCommandCenter,
  retryFailedTurnFromPill,
  seedFailedAgent,
  waitForAgentIdle,
} from "../support/helpers/failed-agents";
import { openAgentRoute, type MockAgentWorkspace } from "../support/helpers/mock-agent";

test.describe("Retrying failed agents", () => {
  test.describe.configure({ timeout: 120_000 });
  const seeded: MockAgentWorkspace[] = [];

  test.afterEach(async () => {
    await cleanupFailedAgents(seeded.splice(0));
  });

  test("Retry on a failed turn restarts only that agent", async ({ page }) => {
    const opened = await seedFailedAgent({ title: "Retry pill agent", error: NETWORK_ERROR });
    seeded.push(opened);
    seeded.push(await seedFailedAgent({ title: "Still failed agent", error: NETWORK_ERROR }));

    await openAgentRoute(page, opened);
    await expect(failedTurnPill(page)).toBeVisible({ timeout: 30_000 });
    await retryFailedTurnFromPill(page, NETWORK_ERROR);

    await waitForAgentIdle(opened);
    await expect(failedTurnPill(page)).toHaveCount(0);
    await expect(failedAgentsCallout(page)).toContainText("Still failed agent");
    await expect(failedAgentsCallout(page)).not.toContainText("Retry pill agent");
  });

  test("Retry all restarts outage failures and leaves usage limits alone", async ({ page }) => {
    const first = await seedFailedAgent({ title: "Outage agent one", error: NETWORK_ERROR });
    seeded.push(first);
    const second = await seedFailedAgent({ title: "Outage agent two", error: NETWORK_ERROR });
    seeded.push(second);
    const limited = await seedFailedAgent({ title: "Usage limit agent", error: USAGE_LIMIT_ERROR });
    seeded.push(limited);

    await gotoAppShell(page);
    const callout = failedAgentsCallout(page);
    await expect(callout).toContainText("2 agents failed", { timeout: 30_000 });
    await expect(callout).toContainText("Outage agent one");
    await expect(callout).toContainText("Outage agent two");
    await expect(callout).not.toContainText("Usage limit agent");
    // The palette retries every failed agent, the usage limit included.
    await expectRetryFailedAgentsInCommandCenter(page, 3);

    await callout.getByText("Retry all", { exact: true }).click();
    await Promise.all([waitForAgentIdle(first), waitForAgentIdle(second)]);
    await expect(callout).toHaveCount(0);

    await openAgentRoute(page, limited);
    await expect(failedTurnPill(page)).toBeVisible({ timeout: 30_000 });
  });

  test("Retry failed agents in the palette also restarts usage limits", async ({ page }) => {
    const outage = await seedFailedAgent({ title: "Palette outage agent", error: NETWORK_ERROR });
    seeded.push(outage);
    const limited = await seedFailedAgent({
      title: "Palette usage limit agent",
      error: USAGE_LIMIT_ERROR,
    });
    seeded.push(limited);

    await gotoAppShell(page);
    await expect(failedAgentsCallout(page)).toContainText("1 agent failed", { timeout: 30_000 });
    await retryFailedAgentsFromCommandCenter(page, 2);

    await Promise.all([waitForAgentIdle(outage), waitForAgentIdle(limited)]);
    await expect(failedAgentsCallout(page)).toHaveCount(0);
  });
});
