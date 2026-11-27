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
import {
  fakePullRequestUrl,
  readFakeGitHubCalls,
  resetFakeGitHub,
  setFakeGitHub,
} from "../support/helpers/fake-github";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedMockAgentWorkspace, type MockAgentWorkspace } from "../support/helpers/mock-agent";
import { openOverviewPanel } from "../support/helpers/workspace-tabs";

// paseo-asks checks the buttons of an ask on a PR that waits for a review against GitHub, read live
// through gh: it refuses only buttons that cannot work (a merge the human cannot perform, a review
// request to Copilot or the author) and accepts the rest. The real plugin runs pinned in
// attention-plugins.ts; a mock agent records asks through its agent tool endpoint, and the worker's
// fake gh answers the read for paseo-e2e/attention-fixture.

test.describe.configure({ mode: "serial", timeout: 240_000 });

let client: AttentionDaemonClient;
let pluginsEnabledBefore: boolean | undefined;

test.beforeAll(async () => {
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

interface PrCase {
  number: number;
  viewerCanMergeAsAdmin: boolean;
  actions: { label: string; prompt: string }[];
}

function seedAgent(title: string): Promise<MockAgentWorkspace> {
  return seedMockAgentWorkspace({ repoPrefix: "asks-buttons-", title });
}

/** Puts a REVIEW_REQUIRED PR on the fake GitHub, then has `agent` record one PR ask with `actions`. */
async function offerButtons(agent: MockAgentWorkspace, pr: PrCase) {
  const key = `paseo-e2e/attention-fixture#${pr.number}`;
  await resetFakeGitHub();
  await setFakeGitHub({
    prs: {
      [key]: {
        state: "OPEN",
        title: `Change ${pr.number}`,
        reviewDecision: "REVIEW_REQUIRED",
        viewerCanMergeAsAdmin: pr.viewerCanMergeAsAdmin,
        author: "pr-author",
      },
    },
    rateLimit: null,
  });
  const result = await callAgentTool("paseo-asks", agent, "ask_create", {
    kind: "pr",
    title: `Ship PR #${pr.number}`,
    links: [{ label: `PR #${pr.number}`, url: fakePullRequestUrl(key) }],
    subscribe: true,
    actions: pr.actions.map((action) => ({ kind: "send", ...action })),
  });
  // A failed read lets any ask through, so every case first proves the plugin read this PR.
  const reads = (await readFakeGitHubCalls()).filter(
    (call) => call.read === "review-buttons" && call.prs.includes(key),
  );
  expect(reads).toHaveLength(1);
  return result;
}

async function savedAsks(agent: MockAgentWorkspace): Promise<string> {
  return (await callAgentTool("paseo-asks", agent, "ask_list", { status: "all" })).text;
}

async function expectShown(page: Page, agent: MockAgentWorkspace, title: string, labels: string[]) {
  await gotoWorkspace(page, agent.workspaceId);
  await openOverviewPanel(page);
  const yourMove = page
    .getByTestId("overview-panel")
    .filter({ visible: true })
    .first()
    .getByTestId("overview-your-move");
  await expect(yourMove).toContainText(title, { timeout: 30_000 });
  for (const label of labels) {
    await expect(yourMove.getByRole("button", { name: label })).toBeVisible();
  }
}

test("refuses a review request to Copilot and tells the agent why", async () => {
  const agent = await seedAgent("Copilot asker");
  try {
    const result = await offerButtons(agent, {
      number: 41,
      viewerCanMergeAsAdmin: true,
      actions: [
        { label: "Request review from Copilot", prompt: "Request a Copilot review on PR #41" },
      ],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("PR #41 is REVIEW_REQUIRED on GitHub");
    expect(result.text).toContain('"Request review from Copilot" asks Copilot');
    expect(result.text).toContain("Nothing was saved.");
    expect(await savedAsks(agent)).toBe("No asks.");
  } finally {
    await resetFakeGitHub();
    await agent.cleanup();
  }
});

test("refuses an admin merge the human cannot perform", async () => {
  const agent = await seedAgent("Admin merger");
  try {
    const result = await offerButtons(agent, {
      number: 42,
      viewerCanMergeAsAdmin: false,
      actions: [{ label: "Merge PR #42 with --admin", prompt: "Merge PR #42 with --admin" }],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("PR #42 is REVIEW_REQUIRED on GitHub");
    expect(result.text).toContain("viewerCanMergeAsAdmin is false");
    expect(result.text).toContain("Nothing was saved.");
    expect(await savedAsks(agent)).toBe("No asks.");
  } finally {
    await resetFakeGitHub();
    await agent.cleanup();
  }
});

test("accepts an ask whose only buttons deliver the PR to a level, and shows it", async ({
  page,
}) => {
  const agent = await seedAgent("Deliverer");
  const labels = ["Deliver PR #43 to dev", "Deliver PR #43 to prod"];
  try {
    const result = await offerButtons(agent, {
      number: 43,
      viewerCanMergeAsAdmin: false,
      actions: labels.map((label) => ({ label, prompt: label })),
    });
    expect(result.isError).toBe(false);
    expect(await savedAsks(agent)).toContain(askIdOf(result));
    await expectShown(page, agent, "Ship PR #43", labels);
  } finally {
    await resetFakeGitHub();
    await agent.cleanup();
  }
});

// The version of paseo-asks before the narrowing refused this ask: it wanted named reviewers and a
// "Merge with --admin" on every REVIEW_REQUIRED PR.
test("accepts a Merge when green without reviewer buttons when the human can merge past the review", async ({
  page,
}) => {
  const agent = await seedAgent("Green merger");
  try {
    const result = await offerButtons(agent, {
      number: 44,
      viewerCanMergeAsAdmin: true,
      actions: [{ label: "Merge when green", prompt: "Merge PR #44 with squash once checks pass" }],
    });
    expect(result.text).not.toContain("REVIEW_REQUIRED");
    expect(result.isError).toBe(false);
    expect(await savedAsks(agent)).toContain(askIdOf(result));
    await expectShown(page, agent, "Ship PR #44", ["Merge when green"]);
  } finally {
    await resetFakeGitHub();
    await agent.cleanup();
  }
});
