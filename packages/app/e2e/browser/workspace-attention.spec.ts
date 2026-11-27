import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import {
  askIdOf,
  callAgentTool,
  connectAttentionClient,
  installAttentionPlugins,
  removeAttentionPlugins,
  type AttentionDaemonClient,
} from "../support/helpers/attention-plugins";
import { gotoAppShell } from "../support/helpers/app";
import {
  fakePullRequestUrl,
  readFakeGitHubCalls,
  resetFakeGitHub,
  setFakeGitHub,
} from "../support/helpers/fake-github";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedMockAgentWorkspace, type MockAgentWorkspace } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { selectSidebarStatusGrouping } from "../support/helpers/sidebar";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { openOverviewPanel } from "../support/helpers/workspace-tabs";

// Workspace attention (docs/workspace-attention.md) end to end: the app decides needs you / working /
// blocked / done from facts the real paseo-status, paseo-asks and paseo-prs plugins report. Agents
// are mock-provider agents; what they "say" goes through the plugins' own agent tool endpoint, the
// same path an agent's MCP bridge takes, so no model runs.

test.describe.configure({ mode: "serial", timeout: 240_000 });

let client: AttentionDaemonClient;
let pluginsEnabledBefore: boolean | undefined;

test.beforeAll(async () => {
  // The first run on a machine clones and prepares the pinned plugins; later runs reuse them.
  test.setTimeout(600_000);
  client = await connectAttentionClient();
  pluginsEnabledBefore = (await client.getDaemonConfig()).config.pluginsEnabled;
  await installAttentionPlugins(client);
});

test.afterAll(async () => {
  test.setTimeout(180_000);
  await removeAttentionPlugins(client);
  await client.patchDaemonConfig({ pluginsEnabled: pluginsEnabledBefore });
  await client.close();
});

function workspaceRow(page: Page, workspaceId: string) {
  return page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspaceId}`).first();
}

async function openOverview(page: Page, workspaceId: string) {
  await gotoWorkspace(page, workspaceId);
  await openOverviewPanel(page);
  const overview = page.getByTestId("overview-panel").filter({ visible: true }).first();
  await expect(overview).toBeVisible();
  return overview;
}

async function seedAgent(title: string): Promise<MockAgentWorkspace> {
  return seedMockAgentWorkspace({ repoPrefix: "attention-", title });
}

test("an agent whose only ask waits on a requested review reads Blocked, not waiting on you", async ({
  page,
}) => {
  const agent = await seedAgent("Review waiter");
  const pr = "paseo-e2e/attention-fixture#65";
  try {
    await resetFakeGitHub();
    await setFakeGitHub({
      prs: {
        [pr]: { state: "OPEN", title: "Restyle the recap", reviewDecision: "REVIEW_REQUIRED" },
      },
      rateLimit: null,
    });
    await callAgentTool("paseo-status", agent, "status_set", {
      state: "waiting_on_you",
      tldr: "PR #65 needs a reviewer or an admin merge.",
    });
    // The A1 shape: the agent asked for a review, the human requested one, so the ask is in
    // progress and the PR waits on a person. paseo-asks reads the PR through the daemon.
    const askId = askIdOf(
      await callAgentTool("paseo-asks", agent, "ask_create", {
        kind: "followup",
        title: "Request review on PR #65",
        links: [{ label: "PR #65", url: fakePullRequestUrl(pr) }],
        subscribe: true,
      }),
    );
    await callAgentTool("paseo-asks", agent, "ask_update", { id: askId, status: "in_progress" });

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await expect(workspaceRow(page, agent.workspaceId)).toBeVisible({ timeout: 30_000 });
    await selectSidebarStatusGrouping(page);
    await expect(
      page
        .getByTestId("sidebar-status-group-rows-blocked")
        .getByTestId(`sidebar-workspace-row-${getServerId()}:${agent.workspaceId}`),
    ).toBeVisible({ timeout: 30_000 });

    const overview = await openOverview(page, agent.workspaceId);
    await expect(overview.getByTestId("overview-status")).toContainText("Blocked");
    await expect(overview.getByTestId("overview-waiting-on")).toContainText(
      "Request review on PR #65",
    );
    await expect(overview.getByTestId(`overview-in-progress-entry-${askId}`)).toContainText(
      "review requested",
    );
    // Nothing waits on the human, so Your move is empty: no Sync asks row either.
    await expect(overview.getByTestId("overview-your-move")).toHaveCount(0);
  } finally {
    await resetFakeGitHub();
    await agent.cleanup();
  }
});

test("each agent waiting without an ask gets its own named Sync asks row until it records one", async ({
  page,
}) => {
  const font = await seedAgent("Pick a font");
  try {
    const created = await font.client.createAgent({
      provider: "mock",
      cwd: font.cwd,
      workspaceId: font.workspaceId,
      title: "Pick a color",
      modeId: "load-test",
      model: "e2e-fast-stream",
    });
    const color = { agentId: created.id, cwd: font.cwd };
    for (const agent of [font, color]) {
      await callAgentTool("paseo-status", agent, "status_set", {
        state: "waiting_on_you",
        tldr: "Which option do you want?",
      });
    }

    const overview = await openOverview(page, font.workspaceId);
    const yourMove = overview.getByTestId("overview-your-move");
    const syncButtons = yourMove.getByRole("button", { name: "Sync asks" });
    await expect(syncButtons).toHaveCount(2, { timeout: 30_000 });
    await expect(yourMove).toContainText("Pick a font says it waits on you");
    await expect(yourMove).toContainText("Pick a color says it waits on you");

    const askId = askIdOf(
      await callAgentTool("paseo-asks", font, "ask_create", {
        kind: "question",
        title: "Which font should the headings use?",
      }),
    );
    // TODO(A26): paseo-asks reaches Overview only on its 8 s summary poll; tighten these to ~1 s
    // once it pushes ask changes to clients.
    await expect(yourMove).toContainText("Which font should the headings use?", {
      timeout: 10_000,
    });
    await expect(syncButtons).toHaveCount(1, { timeout: 10_000 });
    await expect(yourMove).not.toContainText("Pick a font says it waits on you");
    await expect(yourMove).toContainText("Pick a color says it waits on you");
    expect(askId).toMatch(/^A\d+$/);
  } finally {
    await font.cleanup();
  }
});

test("a plugin nudge leaves a waiting card waiting; a person's reply answers it everywhere", async ({
  page,
}) => {
  const agent = await seedAgent("Nudged agent");
  try {
    await callAgentTool("paseo-status", agent, "status_set", {
      state: "waiting_on_you",
      tldr: "Pick M or L.",
    });

    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await selectSidebarStatusGrouping(page);
    const needsYou = page
      .getByTestId("sidebar-status-group-rows-attention")
      .getByTestId(`sidebar-workspace-row-${getServerId()}:${agent.workspaceId}`);
    await expect(needsYou).toBeVisible({ timeout: 30_000 });

    // Sync asks prompts the agent from paseo-status: a plugin-origin turn.
    const overview = await openOverview(page, agent.workspaceId);
    const yourMove = overview.getByTestId("overview-your-move");
    await yourMove.getByRole("button", { name: "Sync asks" }).click();
    await expect(yourMove.getByRole("button", { name: "Asked" })).toBeVisible();
    await agent.client.waitForFinish(agent.agentId, 60_000);
    // The finished turn is unread, which groups the workspace by itself; read it so only the
    // status card decides where it goes.
    await agent.client.clearWorkspaceAttention(agent.workspaceId);

    const pill = page
      .getByRole("button", { name: "Status", exact: true })
      .filter({ visible: true });
    await expect(overview.getByTestId("overview-status")).toContainText("Waiting on you");
    await expect(overview.getByTestId("overview-status-outdated")).toHaveCount(0);
    await expect(pill.first()).toContainText(/^waiting on you · /);
    await expect(needsYou).toBeVisible();

    await agent.client.sendAgentMessage(agent.agentId, "M please");
    await agent.client.waitForFinish(agent.agentId, 60_000);
    await agent.client.clearWorkspaceAttention(agent.workspaceId);
    await expect(overview.getByTestId("overview-status")).toContainText("Answered");
    await expect(overview.getByTestId("overview-status-outdated")).toContainText("You replied");
    await expect(pill.first()).toContainText(/^answered · /);
    await expect(needsYou).toHaveCount(0);
    await expect(
      page
        .getByTestId("sidebar-status-group-rows-done")
        .getByTestId(`sidebar-workspace-row-${getServerId()}:${agent.workspaceId}`),
    ).toBeVisible();
  } finally {
    await agent.cleanup();
  }
});

test("during a GitHub read pause linked PRs stay linked and stale, then read normally", async ({
  page,
}) => {
  const agent = await seedAgent("PR linker");
  const pausedPr = "paseo-e2e/attention-fixture#7";
  const freshPr = "paseo-e2e/attention-fixture#8";
  const primerPr = "paseo-e2e/attention-fixture#9";
  const prs = {
    [pausedPr]: { state: "OPEN" as const, title: "Fix the login redirect" },
    [freshPr]: { state: "OPEN" as const, title: "Speed up search" },
    [primerPr]: { state: "OPEN" as const, title: "Bump dependencies" },
  };
  try {
    await resetFakeGitHub();
    const resetAt = Date.now() + 25_000;
    await setFakeGitHub({
      prs,
      rateLimit: { limit: 5000, remaining: 100, resetAt: new Date(resetAt).toISOString() },
    });

    // GitHub answers with its budget under the 40% reserve, so the daemon pauses reads until reset.
    await client.readChangeRequests([fakePullRequestUrl(primerPr)]);
    expect(await client.readChangeRequests([fakePullRequestUrl(pausedPr)])).toMatchObject([
      { ok: false, reason: "paused" },
    ]);

    const linked = await callAgentTool("paseo-prs", agent, "prs_link", {
      urls: [fakePullRequestUrl(pausedPr)],
    });
    expect(linked.isError).toBe(false);
    expect(linked.text).not.toContain("not found");

    const overview = await openOverview(page, agent.workspaceId);
    // A finished turn makes paseo-prs refresh past its cache; the read is still paused.
    await agent.client.sendAgentMessage(agent.agentId, "status?");
    await agent.client.waitForFinish(agent.agentId, 60_000);
    const pullRequests = overview.getByTestId("overview-pull-requests").first();
    await expect(pullRequests).toContainText("#7", { timeout: 30_000 });
    await expect(pullRequests).toContainText("not refreshed");
    expect(
      (await readFakeGitHubCalls()).filter((call) => call.prs.includes(pausedPr)),
    ).toHaveLength(0);

    await expect.poll(() => Date.now(), { timeout: 40_000 }).toBeGreaterThan(resetAt + 2_000);
    await setFakeGitHub({ prs, rateLimit: null });
    await agent.client.sendAgentMessage(agent.agentId, "status?");
    await agent.client.waitForFinish(agent.agentId, 60_000);
    await expect(pullRequests).toContainText("Fix the login redirect", { timeout: 30_000 });
    await expect(pullRequests).not.toContainText("not refreshed");

    // Two reads of the same PR at once share one GitHub read (#281).
    const before = (await readFakeGitHubCalls()).filter((call) => call.prs.includes(freshPr));
    expect(before).toHaveLength(0);
    const [first, second] = await Promise.all([
      client.readChangeRequests([fakePullRequestUrl(freshPr)]),
      client.readChangeRequests([fakePullRequestUrl(freshPr)]),
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject([{ ok: true, number: 8, title: "Speed up search", state: "open" }]);
    expect((await readFakeGitHubCalls()).filter((call) => call.prs.includes(freshPr))).toHaveLength(
      1,
    );
  } finally {
    await resetFakeGitHub();
    await agent.cleanup();
  }
});
