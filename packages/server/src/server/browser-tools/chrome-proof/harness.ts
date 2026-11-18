/** Opt-in real-provider experiment. This is test code, not a daemon launch path. */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import type { BrowserAutomationExecuteRequest } from "@getpaseo/protocol/browser-automation/rpc-schemas";
import { CLIENT_CAPS } from "@getpaseo/protocol/client-capabilities";
import { createPaseoDaemon, type PaseoDaemon } from "../../bootstrap.js";
import { ClaudeAgentClient } from "../../agent/providers/claude/agent.js";
import { CodexAppServerAgentClient } from "../../agent/providers/codex-app-server-agent.js";
import { DaemonClient } from "../../test-utils/daemon-client.js";
import { BuiltinPluginLoader } from "../../plugins/builtin/index.js";
import { createChromeProofAdapter } from "./adapter.js";

const supportedCommands = ["list_tabs", "new_tab", "snapshot", "click"] as const;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} explicitly for this opt-in experiment`);
  return value;
}

async function createFixture() {
  let nonce = randomUUID();
  const receipts: Array<{ nonce: string; receivedAt: string }> = [];
  const fixturePath = `/proof/${randomUUID()}`;
  const server = createServer((request, response) => {
    if (request.url === fixturePath && request.method === "GET") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(`<!doctype html><html><head><title>Chrome proof fixture</title></head><body>
<h1>Isolated Chrome proof</h1><button id="complete">Complete proof</button><p id="result">Ready</p>
<script>document.querySelector('#complete').onclick=async()=>{
const result=await fetch(${JSON.stringify(`${fixturePath}/receipt`)},{method:'POST',body:${JSON.stringify(nonce)}});
if(result.ok)document.querySelector('#result').textContent=${JSON.stringify(`Proof completed: ${nonce}`)};
};</script></body></html>`);
      return;
    }
    if (request.url === `${fixturePath}/receipt` && request.method === "POST") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > 128) request.destroy();
      });
      request.on("end", () => {
        if (body !== nonce) {
          response.writeHead(400).end();
          return;
        }
        receipts.push({ nonce, receivedAt: new Date().toISOString() });
        response.writeHead(204).end();
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not bind TCP");
  return {
    url: `http://127.0.0.1:${address.port}${fixturePath}`,
    receipts,
    begin() {
      nonce = randomUUID();
      return nonce;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

async function verifyOwnerRejection(
  adapter: ReturnType<typeof createChromeProofAdapter>,
  probe: BrowserAutomationExecuteRequest,
  serverId: string,
) {
  let competingOwnerRejected = false;
  try {
    await adapter.admitOwner({ serverId: "foreign", agentId: "foreign", workspaceId: "foreign" });
  } catch {
    competingOwnerRejected = true;
  }
  if (!competingOwnerRejected) throw new Error("Adapter admitted a competing owner");
  const evidenceCount = adapter.evidence.length;
  const foreignSource = await adapter.execute(probe, "foreign");
  const foreignAgent = await adapter.execute({ ...probe, agentId: "foreign" }, serverId);
  if (
    foreignSource.payload.ok ||
    foreignAgent.payload.ok ||
    adapter.evidence.length !== evidenceCount
  ) {
    throw new Error("Foreign request reached adapter dispatch");
  }
}

async function verifyReleasedOwner(
  adapter: ReturnType<typeof createChromeProofAdapter>,
  probe: BrowserAutomationExecuteRequest,
  serverId: string,
) {
  const evidenceCount = adapter.evidence.length;
  const released = await adapter.execute(
    { ...probe, requestId: `released-${randomUUID()}` },
    serverId,
  );
  if (released.payload.ok || adapter.evidence.length !== evidenceCount) {
    throw new Error("Released owner reached adapter dispatch");
  }
}

export async function runChromeProof(): Promise<void> {
  if (process.env.PASEO_CHROME_PROOF !== "1") throw new Error("Set PASEO_CHROME_PROOF=1");
  const agentBrowserPath = requiredEnv("A2_AGENT_BROWSER_PATH");
  const cdpEndpoint = requiredEnv("A2_CDP_ENDPOINT");
  const models = { claude: requiredEnv("A2_CLAUDE_MODEL"), codex: requiredEnv("A2_CODEX_MODEL") };
  const proofRoot = path.resolve(process.env.A2_PROOF_ROOT ?? ".dev/chrome-proof");
  await mkdir(proofRoot, { recursive: true, mode: 0o700 });
  const runDir = await mkdtemp(path.join(proofRoot, "run-"));
  const fixture = await createFixture();
  const adapter = await createChromeProofAdapter({
    agentBrowserPath,
    cdpEndpoint,
    fixtureUrl: fixture.url,
    stateDir: path.join(runDir, "adapter"),
  });
  const daemons: PaseoDaemon[] = [];
  const clients: DaemonClient[] = [];
  const observations: Array<{ release(): Promise<void> }> = [];
  const activeAgents: Array<{ daemon: PaseoDaemon; agentId: string }> = [];
  const results: Array<Record<string, unknown>> = [];
  const logger = pino({ level: "warn" }, pino.destination(path.join(runDir, "daemon.log")));
  let completed = false;
  const startedAt = new Date().toISOString();
  try {
    // Independent identities, stores, providers and loopback listeners; shared Mac adapter.
    for (const provider of ["claude", "codex"] as const) {
      const home = path.join(runDir, provider, "home");
      const staticDir = path.join(runDir, provider, "static");
      await mkdir(home, { recursive: true, mode: 0o700 });
      await mkdir(staticDir, { recursive: true });
      const daemon = await createPaseoDaemon(
        {
          listen: "127.0.0.1:0",
          paseoHome: home,
          corsAllowedOrigins: [],
          hostnames: true,
          mcpEnabled: true,
          mcpInjectIntoAgents: true,
          browserToolsEnabled: true,
          staticDir,
          mcpDebug: false,
          agentClients:
            provider === "claude"
              ? { claude: new ClaudeAgentClient({ logger }) }
              : { codex: new CodexAppServerAgentClient(logger) },
          agentStoragePath: path.join(home, "agents"),
          relayEnabled: false,
          pluginsEnabled: false,
          metadataGeneration: { providers: [] },
          appBaseUrl: "https://app.paseo.sh",
        },
        logger,
        { builtinPlugins: new BuiltinPluginLoader(undefined, []) },
      );
      daemons.push(daemon);
      await daemon.start();
      const target = daemon.getListenTarget();
      if (!target || target.type !== "tcp") throw new Error("Proof daemon did not bind TCP");
      const registration = { hostKind: "desktop app", supportedCommands: [...supportedCommands] };
      const client = new DaemonClient({
        url: `ws://127.0.0.1:${target.port}/ws`,
        appVersion: "0.14.0",
        clientType: "browser",
        clientId: `chrome-proof-${provider}-${randomUUID()}`,
        reconnect: { enabled: false },
        capabilities: { [CLIENT_CAPS.browserHost]: registration },
      });
      clients.push(client);
      const dispatches: Array<{ command: string; ok: boolean }> = [];
      client.on(
        "browser.automation.execute.request",
        (request: BrowserAutomationExecuteRequest) => {
          void adapter
            .execute(request, daemon.getServerId())
            .then((response) => {
              dispatches.push({ command: request.command.command, ok: response.payload.ok });
              client.sendBrowserAutomationExecuteResponse(response);
              return undefined;
            })
            .catch(() => {
              dispatches.push({ command: request.command.command, ok: false });
              client.sendBrowserAutomationExecuteResponse({
                type: "browser.automation.execute.response",
                payload: {
                  requestId: request.requestId,
                  ok: false,
                  error: {
                    code: "browser_unknown_error",
                    message: "Proof adapter failed; recovery required",
                    retryable: false,
                  },
                },
              });
            });
        },
      );
      await client.connect();
      await client.fetchAgents({ subscribe: {} });
      const observation = client.registerBrowserHost(registration);
      observations.push(observation);
      await observation.ready;
      const cwd = path.join(runDir, provider, "workspace");
      await mkdir(cwd, { recursive: true });
      const workspace = await client.createWorkspace({ source: { kind: "directory", path: cwd } });
      if (!workspace.workspace) throw new Error("Proof workspace creation failed");
      const agent = await client.createAgent({
        config: {
          provider,
          cwd,
          model: models[provider],
          modeId: provider === "claude" ? "bypassPermissions" : "full-access",
        },
        workspaceId: workspace.workspace.id,
      });
      activeAgents.push({ daemon, agentId: agent.id });
      await adapter.admitOwner({
        serverId: daemon.getServerId(),
        agentId: agent.id,
        workspaceId: workspace.workspace.id,
      });
      const denialProbe: BrowserAutomationExecuteRequest = {
        type: "browser.automation.execute.request",
        requestId: `denial-${randomUUID()}`,
        agentId: agent.id,
        workspaceId: workspace.workspace.id,
        command: { command: "list_tabs", args: {} },
      };
      await verifyOwnerRejection(adapter, denialProbe, daemon.getServerId());
      const nonce = fixture.begin();
      const prompt = [
        "This is a bounded browser integration proof. Use only Paseo browser tools; tool discovery is allowed.",
        "Do not use shell, filesystem, HTTP clients, external browser tools, or delegation.",
        `Use browser_new_tab to open ${fixture.url}. Take browser_snapshot, click the single 'Complete proof' button by its returned ref, then take browser_snapshot again.`,
        `Verify the visible text is exactly 'Proof completed: ${nonce}'. Do not navigate elsewhere or touch any other tab.`,
        `Finish with PROOF_OK_${nonce} only if the final snapshot shows that text; otherwise report failure.`,
      ].join("\n");
      const runStartedAt = new Date().toISOString();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          daemon.agentManager.runAgent(agent.id, prompt),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Real-provider proof exceeded 180 seconds")),
              180_000,
            );
          }),
        ]);
        const received = fixture.receipts.filter((receipt) => receipt.nonce === nonce);
        const verified =
          !result.canceled &&
          result.finalText.includes(`PROOF_OK_${nonce}`) &&
          received.length === 1 &&
          dispatches.some((item) => item.command === "click" && item.ok) &&
          dispatches.filter((item) => item.command === "snapshot" && item.ok).length >= 2;
        results.push({
          provider,
          model: models[provider],
          serverId: daemon.getServerId(),
          agentId: agent.id,
          startedAt: runStartedAt,
          finishedAt: new Date().toISOString(),
          nonce,
          dispatches,
          receipts: received,
          competingOwnerRejected: true,
          foreignSourceRejected: true,
          foreignAgentRejected: true,
          verified,
        });
        if (!verified) throw new Error(`${provider} did not satisfy browser proof assertions`);
        console.log(JSON.stringify({ provider, verified, runDir }));
      } finally {
        if (timer) clearTimeout(timer);
        await daemon.agentManager.cancelAgentRun(agent.id);
        await adapter.releaseOwner();
      }
      await verifyReleasedOwner(adapter, denialProbe, daemon.getServerId());
      results[results.length - 1]!.releasedOwnerRejected = true;
    }
    completed = true;
  } finally {
    for (const { daemon, agentId } of activeAgents)
      await daemon.agentManager.cancelAgentRun(agentId).catch(() => undefined);
    await adapter.close().catch(() => undefined);
    for (const observation of observations) await observation.release().catch(() => undefined);
    for (const client of clients) await client.close().catch(() => undefined);
    for (const daemon of daemons) await daemon.stop().catch(() => undefined);
    await fixture.close();
    await writeFile(
      path.join(runDir, "proof.json"),
      JSON.stringify(
        {
          kind: "two-local-daemons-real-providers-fresh-chrome-fixture",
          startedAt,
          finishedAt: new Date().toISOString(),
          completed,
          realRemoteNetworkVerified: false,
          passkeyVerified: false,
          adapterEvidence: adapter.evidence,
          results,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    logger.flush();
  }
}

if (process.env.PASEO_CHROME_PROOF === "1") {
  void runChromeProof().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Chrome proof failed");
    process.exitCode = 1;
  });
}
