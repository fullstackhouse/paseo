import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expect } from "@playwright/test";
import { connectDaemonClient } from "./daemon-client-loader";

/** The daemon calls this suite makes beyond seeding: plugins, PR reads and human prompts. */
export interface AttentionDaemonClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  getDaemonConfig(): Promise<{ config: { pluginsEnabled?: boolean } }>;
  patchDaemonConfig(patch: { pluginsEnabled?: boolean }): Promise<unknown>;
  installDirectoryPlugin(directory: string): Promise<unknown>;
  removePlugin(pluginId: string): Promise<void>;
  readChangeRequests(urls: string[]): Promise<unknown[]>;
  sendAgentMessage(agentId: string, text: string): Promise<unknown>;
}

export function connectAttentionClient(): Promise<AttentionDaemonClient> {
  return connectDaemonClient<AttentionDaemonClient>({ clientIdPrefix: "app-e2e-attention" });
}

const run = promisify(execFile);

/**
 * The real FSH plugins workspace attention is built from (docs/workspace-attention.md), pinned to
 * exact commits so the suite only changes when these pins do. Bump a pin to the plugin's current
 * main with `git ls-remote https://github.com/fullstackhouse/<repo>.git refs/heads/main`, run
 * `workspace-attention.spec.ts` and `asks-pr-buttons.spec.ts`, and commit the new pin with what it
 * brings in. CI caches the prepared checkouts keyed by this file, so a bump re-prepares them once.
 */
export const ATTENTION_PLUGINS = {
  "paseo-status": { commit: "8215548e8bdfbe04961ac3cac1ca49eaa4f798c0", dataDir: "status" },
  "paseo-asks": { commit: "7e3f87b850f456de0cbbe7b86d954d780be4d65b", dataDir: "asks" },
  "paseo-prs": { commit: "165fadc552e16d383592167f3315cb052b72b71b", dataDir: "prs" },
} as const;

export type AttentionPluginId = keyof typeof ATTENTION_PLUGINS;

/** Prepared checkouts live here between runs; CI restores the directory from its cache. */
export const ATTENTION_PLUGIN_CACHE =
  process.env.E2E_ATTENTION_PLUGIN_CACHE ??
  path.resolve(__dirname, "../../../../../.dev/e2e-attention-plugins");

/**
 * A pinned checkout with its manifest's declared preparation (`npm ci`) done, the same steps a
 * Git install runs, so installing it as a directory plugin is quick on every later run.
 */
async function preparedCheckout(id: AttentionPluginId): Promise<string> {
  const { commit } = ATTENTION_PLUGINS[id];
  const directory = path.join(ATTENTION_PLUGIN_CACHE, `${id}-${commit}`);
  const ready = path.join(directory, ".e2e-ready");
  if (existsSync(ready)) return directory;
  await rm(directory, { recursive: true, force: true });
  await mkdir(ATTENTION_PLUGIN_CACHE, { recursive: true });
  await run("git", ["clone", "--quiet", `https://github.com/fullstackhouse/${id}.git`, directory]);
  await run("git", ["checkout", "--quiet", "--detach", commit], { cwd: directory });
  const manifest = JSON.parse(
    await readFile(path.join(directory, "paseo-plugin.json"), "utf8"),
  ) as {
    build?: string[][];
  };
  for (const [command, ...args] of manifest.build ?? []) {
    await run(command!, args, { cwd: directory, maxBuffer: 64 * 1024 * 1024 });
  }
  await writeFile(ready, commit);
  return directory;
}

export async function installAttentionPlugins(client: AttentionDaemonClient): Promise<void> {
  await client.patchDaemonConfig({ pluginsEnabled: true });
  for (const id of Object.keys(ATTENTION_PLUGINS) as AttentionPluginId[]) {
    await client.installDirectoryPlugin(await preparedCheckout(id));
  }
  for (const id of Object.keys(ATTENTION_PLUGINS) as AttentionPluginId[]) {
    await expect
      .poll(() => existsSync(bridgeFile(id)), {
        message: `${id} never started its agent tool listener`,
        timeout: 60_000,
      })
      .toBe(true);
  }
}

export async function removeAttentionPlugins(client: AttentionDaemonClient): Promise<void> {
  for (const id of Object.keys(ATTENTION_PLUGINS)) {
    await client.removePlugin(id).catch(() => undefined);
  }
}

function bridgeFile(id: AttentionPluginId): string {
  const home = process.env.E2E_PASEO_HOME;
  if (!home) throw new Error("E2E_PASEO_HOME is not set; is the e2e worker daemon running?");
  return path.join(home, "plugin-data", ATTENTION_PLUGINS[id].dataDir, "server.json");
}

export interface PluginToolResult {
  text: string;
  isError: boolean;
}

/**
 * Calls one of a plugin's agent tools as `agentId`, the way the plugin's stdio MCP bridge does for
 * a real agent: the bridge only forwards `{ agentId, cwd, name, arguments }` to the plugin's
 * localhost listener. Lets a spec script what agents say without a model.
 */
export async function callAgentTool(
  id: AttentionPluginId,
  agent: { agentId: string; cwd: string },
  name: string,
  args: Record<string, unknown>,
): Promise<PluginToolResult> {
  const { port, token } = JSON.parse(await readFile(bridgeFile(id), "utf8")) as {
    port: number;
    token: string;
  };
  const response = await fetch(`http://127.0.0.1:${port}/call`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ agentId: agent.agentId, cwd: agent.cwd, name, arguments: args }),
  });
  const body = (await response.json()) as { text?: string; isError?: boolean; error?: string };
  if (!response.ok) throw new Error(`${id} ${name} failed: ${body.error ?? response.statusText}`);
  return { text: body.text ?? "", isError: Boolean(body.isError) };
}

/** `ask_create` answers "A3 [open] question: …"; returns the ask id. */
export function askIdOf(result: PluginToolResult): string {
  const id = /^(A\d+) \[/.exec(result.text)?.[1];
  if (!id || result.isError) throw new Error(`ask_create did not create an ask: ${result.text}`);
  return id;
}
