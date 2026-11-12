import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { test, expect } from "../support/fixtures";
import { pluginRequirements } from "../support/helpers/plugin-fixture";
import { gotoAppShell } from "../support/helpers/app";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";

const run = promisify(execFile);

test("managed plugins update on connection without asking", async ({ page }, info) => {
  test.setTimeout(180_000);
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-auto-update-"));
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "plugin-updates" });
  const config = await client.getDaemonConfig();
  const pluginId = "automatic-update-example";
  const git = (...args: string[]) => run("git", args, { cwd: directory });
  let installed = false;
  try {
    await git("init", "-b", "main");
    await git("config", "user.name", "Paseo Tests");
    await git("config", "user.email", "paseo@example.test");
    await writeFile(
      path.join(directory, "paseo-plugin.json"),
      JSON.stringify({ id: pluginId, requirements: pluginRequirements }),
    );
    await writeFile(
      path.join(directory, "index.server.ts"),
      "export default function contribute() { return () => {}; }\n",
    );
    await git("add", ".");
    await git("commit", "-m", "initial plugin");
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installPluginSource({ source: `git:${pathToFileURL(directory).href}` });
    installed = true;

    await writeFile(
      path.join(directory, "index.server.ts"),
      "// Updated plugin\nexport default function contribute() { return () => {}; }\n",
    );
    await git("add", ".");
    await git("commit", "-m", "update plugin");
    const revision = (await git("rev-parse", "HEAD")).stdout.trim();
    expect(await client.previewPluginUpdates({ pluginId })).toMatchObject([
      { id: pluginId, outcome: "update" },
    ]);

    await gotoAppShell(page);
    await expect
      .poll(
        async () => {
          const sources = await client.getPluginSourceStatus(pluginId);
          return sources[0]?.installation?.currentRevision;
        },
        { timeout: 60_000 },
      )
      .toBe(revision);
    await expect(page.getByTestId("plugin-update-callout")).toHaveCount(0);
    expect(await client.previewPluginUpdates({ pluginId })).toMatchObject([
      { id: pluginId, outcome: "current" },
    ]);
    await info.attach("automatic-plugin-update", {
      body: await page.screenshot({ path: info.outputPath("automatic-update.png") }),
      contentType: "image/png",
    });

    await writeFile(path.join(directory, "index.server.ts"), "export default !!! broken;\n");
    await git("add", ".");
    await git("commit", "-m", "broken plugin update");
    await page.reload();
    const failure = page.getByTestId("plugin-update-callout");
    await expect(failure).toContainText("Plugin update failed", { timeout: 60_000 });
    await expect(failure.getByText("Retry", { exact: true })).toBeVisible();
    expect((await client.getPluginSourceStatus(pluginId))[0]?.installation?.currentRevision).toBe(
      revision,
    );
    await info.attach("failed-plugin-update", {
      body: await page.screenshot({ path: info.outputPath("failed-update.png") }),
      contentType: "image/png",
    });
  } finally {
    if (installed) await client.removePlugin(pluginId);
    await client.patchDaemonConfig({ pluginsEnabled: config.config.pluginsEnabled });
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
