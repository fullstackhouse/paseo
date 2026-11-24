import { expect } from "@playwright/test";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { test } from "../support/fixtures";
import { NETWORK_ERROR } from "../support/helpers/failed-agents";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import {
  archiveFinishedSubagents,
  expectManagedSubagentArchived,
  expectSubagentRowGone,
  expectSubagentRowVisible,
  openSubagentsTrack,
  seedParentWithSubagent,
} from "../support/helpers/subagents";

test.describe("Subagents grouped by what they ask of you", () => {
  let workspace: SeededWorkspace;

  test.beforeAll(async () => {
    workspace = await seedWorkspace({ repoPrefix: "subagents-groups-" });
  });

  test.afterAll(async () => {
    await workspace?.cleanup();
  });

  test("lists the failure first, folds done work, and clears done without the failure", async ({
    page,
  }, testInfo) => {
    const agents = await seedParentWithSubagent(workspace, {
      parentTitle: "Fan-out parent",
      childTitle: "Finished child",
    });
    const failed = await workspace.client.createAgent({
      provider: "mock",
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Failed child",
      modeId: "load-test",
      model: "e2e-fast-stream",
      labels: { [PARENT_AGENT_ID_LABEL]: agents.parent.id },
      initialPrompt: `Emit a synthetic turn failure: ${NETWORK_ERROR}`,
    });
    await workspace.client.waitForAgentUpsert(failed.id, (s) => s.status === "error", 30_000);

    await openAgentRoute(page, { workspaceId: agents.workspaceId, agentId: agents.parent.id });
    await openSubagentsTrack(page);

    const panel = page.getByTestId("subagents-track-header-panel");
    const failedGroup = page.getByTestId("subagents-track-group-failed");
    const doneGroup = page.getByTestId("subagents-track-group-done");
    await expect(failedGroup).toContainText("Failed · 1");
    await expect(doneGroup).toContainText("Done · 1");
    await expectSubagentRowVisible(page, failed.id);
    await expect(page.getByTestId("subagents-track-retry-failed")).toBeVisible();
    // Done folds while something else is in the list.
    await expectSubagentRowGone(page, agents.child.id);
    await testInfo.attach("subagents-groups", {
      body: await panel.screenshot(),
      contentType: "image/png",
    });

    await doneGroup.click();
    await expectSubagentRowVisible(page, agents.child.id);

    await archiveFinishedSubagents(page);
    await expectManagedSubagentArchived(workspace, agents.child.id);
    await expectSubagentRowGone(page, agents.child.id);
    await expectSubagentRowVisible(page, failed.id);

    await workspace.client.archiveAgent(failed.id).catch(() => undefined);
  });
});
