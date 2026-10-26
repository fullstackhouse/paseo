import { execFileSync } from "node:child_process";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { type Page } from "@playwright/test";
import { buildHostWorkspaceRoute } from "../../src/utils/host-routes";
import { test, expect } from "../support/fixtures";
import { getServerId } from "../support/helpers/server-id";
import { connectSeedClient } from "../support/helpers/seed-client";
import { createTempGitRepo } from "../support/helpers/workspace";
import { openChangesPanel, waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";

const IMAGES = path.resolve(__dirname, "../../assets/images");
const cleanupTasks: Array<() => Promise<void>> = [];

test.afterEach(async () => {
  for (const task of cleanupTasks.splice(0)) await task();
});

async function createImageWorkspace(): Promise<{ id: string; repoPath: string }> {
  const repo = await createTempGitRepo("changes-images-");
  const client = await connectSeedClient();
  cleanupTasks.push(async () => {
    await client.close().catch(() => undefined);
    await repo.cleanup().catch(() => undefined);
  });
  await mkdir(path.join(repo.path, "screens"));
  await copyFile(path.join(IMAGES, "favicon-light.png"), path.join(repo.path, "screens/home.png"));
  execFileSync("git", ["add", "screens"], { cwd: repo.path });
  execFileSync("git", ["commit", "-m", "Add screen"], { cwd: repo.path });
  // The favicon variants share bytes across themes; these three differ.
  await copyFile(
    path.join(IMAGES, "favicon-light-running.png"),
    path.join(repo.path, "screens/home.png"),
  );
  await copyFile(
    path.join(IMAGES, "favicon-light-attention.png"),
    path.join(repo.path, "screens/added.png"),
  );
  const created = await client.createWorkspace({ source: { kind: "directory", path: repo.path } });
  if (!created.workspace) throw new Error(created.error ?? "Failed to create image workspace");
  return { id: created.workspace.id, repoPath: repo.path };
}

function preview(page: Page, filePath: string) {
  return page
    .getByTestId("working-diff-panel")
    .filter({ visible: true })
    .locator(`[data-diff-image-path="${filePath}"]`);
}

test("changed images render before/after previews that follow rewrites", async ({ page }) => {
  const workspace = await createImageWorkspace();
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
  await waitForWorkspaceTabsVisible(page);
  await openChangesPanel(page, 60_000);

  const modified = preview(page, "screens/home.png");
  await expect(modified.getByRole("img", { name: "Before" })).toBeVisible({ timeout: 30_000 });
  await expect(modified.getByRole("img", { name: "After" })).toBeVisible();
  // Small images keep their natural 48px size instead of stretching to the frame.
  const before = await modified.getByRole("img", { name: "Before" }).boundingBox();
  expect(before?.width).toBe(48);
  const added = preview(page, "screens/added.png");
  await expect(added.getByRole("img", { name: "After" })).toBeVisible();
  await expect(added.getByRole("img", { name: "Before" })).toHaveCount(0);

  await expect(modified.getByText("After · 2.1 KB")).toBeVisible();
  await copyFile(
    path.join(IMAGES, "android-icon-foreground.png"),
    path.join(workspace.repoPath, "screens/home.png"),
  );
  await expect(modified.getByText("After · 18.1 KB")).toBeVisible({ timeout: 30_000 });
  await expect(modified.getByRole("img", { name: "After" })).toBeVisible();
});
