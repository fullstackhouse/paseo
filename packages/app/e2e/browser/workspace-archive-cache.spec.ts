import type { Page } from "@playwright/test";
import { buildHostWorkspaceRoute, buildOpenProjectRoute } from "@/utils/host-routes";
import { LAST_WORKSPACE_SELECTION_STORAGE_KEY } from "@/stores/last-workspace-selection";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { waitForWorkspaceInReplicaCache } from "../support/helpers/replica-cache-storage";
import { expectAppRoute } from "../support/helpers/route-assertions";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import {
  expectWorkspaceAbsentFromSidebar,
  selectWorkspaceInSidebar,
} from "../support/helpers/sidebar";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

async function archiveWorkspaceOutsideTheApp(workspace: SeededWorkspace): Promise<void> {
  const result = await workspace.client.archiveWorkspace(workspace.workspaceId);
  expect(result.error).toBeNull();
}

async function readSavedWorkspaceId(page: Page): Promise<string | null> {
  const stored = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    LAST_WORKSPACE_SELECTION_STORAGE_KEY,
  );
  if (!stored) return null;
  const parsed: { workspaceId?: string } = JSON.parse(stored);
  return parsed.workspaceId ?? null;
}

async function expectSavedWorkspace(page: Page, workspaceId: string | null): Promise<void> {
  await expect.poll(() => readSavedWorkspaceId(page), { timeout: 30_000 }).toBe(workspaceId);
}

async function openWorkspaceFromSidebar(page: Page, workspaceId: string): Promise<void> {
  await gotoAppShell(page);
  await waitForSidebarHydration(page);
  await selectWorkspaceInSidebar(page, workspaceId);
  await expectSavedWorkspace(page, workspaceId);
}

// Leaves the app's origin so the next `gotoAppShell` is a fresh launch at `/`, with storage kept.
async function closeApp(page: Page): Promise<void> {
  await page.goto("about:blank");
}

async function expectWorkspaceUnavailable(page: Page): Promise<void> {
  await expect(page.getByText("Workspace unavailable", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("workspace-missing-go-home")).toBeVisible();
  await expect(page.getByTestId("workspace-missing-new-workspace")).toBeVisible();
}

test.describe("Workspace archive cache coherence", () => {
  test("an archived selected workspace cannot return from the durable cache", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "archive-cache-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await selectWorkspaceInSidebar(page, workspace.workspaceId);
      await waitForWorkspaceInReplicaCache(page, workspace.workspaceId);

      await archiveWorkspaceOutsideTheApp(workspace);

      await expectWorkspaceAbsentFromSidebar(page, workspace.workspaceId);
      // The screen had it live, so it leaves for New workspace, as the app's own Archive does.
      await expect
        .poll(
          () => {
            const url = new URL(page.url());
            return `${url.pathname}?serverId=${url.searchParams.get("serverId")}`;
          },
          { timeout: 30_000 },
        )
        .toBe(`/new?serverId=${getServerId()}`);
      await expect(page.getByText("Workspace unavailable", { exact: true })).toHaveCount(0);
    } finally {
      await workspace.cleanup();
    }
  });
});

test.describe("Remembered workspace archived while the app is closed", () => {
  test("the second launch opens the home screen", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "archive-closed-" });

    try {
      await openWorkspaceFromSidebar(page, workspace.workspaceId);
      await closeApp(page);
      await archiveWorkspaceOutsideTheApp(workspace);

      await gotoAppShell(page);
      await expectWorkspaceUnavailable(page);
      await expectSavedWorkspace(page, null);

      await gotoAppShell(page);
      await expectAppRoute(page, buildOpenProjectRoute(), { timeout: 30_000 });
    } finally {
      await workspace.cleanup();
    }
  });

  test("reloading the unavailable screen does not save the workspace again", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "archive-reload-" });

    try {
      await openWorkspaceFromSidebar(page, workspace.workspaceId);
      await closeApp(page);
      await archiveWorkspaceOutsideTheApp(workspace);

      await gotoAppShell(page);
      await expectWorkspaceUnavailable(page);
      await page.reload();
      await expectWorkspaceUnavailable(page);
      await expectSavedWorkspace(page, null);

      await gotoAppShell(page);
      await expectAppRoute(page, buildOpenProjectRoute(), { timeout: 30_000 });
    } finally {
      await workspace.cleanup();
    }
  });

  test("a link to an archived workspace keeps the saved live workspace", async ({ page }) => {
    const archived = await seedWorkspace({ repoPrefix: "archive-link-gone-" });
    const live = await seedWorkspace({ repoPrefix: "archive-link-live-" });

    try {
      await archiveWorkspaceOutsideTheApp(archived);
      await openWorkspaceFromSidebar(page, live.workspaceId);

      await page.goto(buildHostWorkspaceRoute(getServerId(), archived.workspaceId));
      await expectWorkspaceUnavailable(page);
      await expectSavedWorkspace(page, live.workspaceId);

      await gotoAppShell(page);
      await expectAppRoute(page, buildHostWorkspaceRoute(getServerId(), live.workspaceId), {
        timeout: 30_000,
      });
    } finally {
      await archived.cleanup();
      await live.cleanup();
    }
  });
});
