/** Opt-in human-authentication experiment. Never use this as a product daemon launcher. */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { CLIENT_CAPS } from "@getpaseo/protocol/client-capabilities";
import { createPaseoDaemon, type PaseoDaemon } from "../../bootstrap.js";
import { ClaudeAgentClient } from "../../agent/providers/claude/agent.js";
import { CodexAppServerAgentClient } from "../../agent/providers/codex-app-server-agent.js";
import { DaemonClient } from "../../test-utils/daemon-client.js";
import { BuiltinPluginLoader } from "../../plugins/builtin/index.js";
import { createChromeProofAdapter } from "./adapter.js";

type Provider = "claude" | "codex";
type Adapter = ReturnType<typeof createChromeProofAdapter>;
const site = "https://webauthn.io/";
const successIndicator = "You're logged in!";
const commands = ["list_tabs", "new_tab", "snapshot"] as const;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} explicitly`);
  return value;
}

function loopbackCdpEndpoint(): string {
  const value = required("A2_CDP_ENDPOINT");
  if (/^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 65535) return value;
  const endpoint = new URL(value);
  if (
    !["http:", "ws:"].includes(endpoint.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new Error("A2_CDP_ENDPOINT must explicitly target loopback Chrome");
  }
  return value;
}

async function formBody(request: IncomingMessage): Promise<URLSearchParams> {
  let value = "";
  for await (const chunk of request) {
    value += String(chunk);
    if (value.length > 2048) throw new Error("Control request too large");
  }
  return new URLSearchParams(value);
}

export async function createControl(adapter: Pick<Adapter, "holdForHuman" | "continueAfterHuman">) {
  let origin = "";
  let token = randomUUID();
  const stopToken = randomUUID();
  let phase: "preparing" | "running" | "stopping" | "human" | "resuming" | "finished" = "preparing";
  let provider: Provider = "claude";
  let waiting: (() => void) | undefined;
  let humanPromise = Promise.resolve();
  let holdPromise: Promise<void> | undefined;
  let confirmedAt: string | undefined;
  const stop = async () => {
    if (phase === "human" || phase === "finished") return;
    if (phase === "preparing") {
      phase = "stopping";
      return;
    }
    if (holdPromise) return holdPromise;
    phase = "stopping";
    token = randomUUID();
    // The adapter closes admission synchronously, including during an in-flight Continue.
    const held = adapter.holdForHuman();
    holdPromise = (async () => {
      await held;
      phase = "human";
      if (!waiting) {
        humanPromise = new Promise<void>((resolve) => {
          waiting = resolve;
        });
      }
      console.log(
        JSON.stringify({ event: "human_authentication_ready", provider, controlUrl: origin, site }),
      );
    })();
    return holdPromise;
  };
  const html =
    () => `<!doctype html><html><head><meta charset="utf-8"><title>Paseo Chrome proof</title>
${phase === "running" || phase === "preparing" || phase === "stopping" ? '<meta http-equiv="refresh" content="3">' : ""}
</head><body><h1>Paseo Chrome proof: ${provider}</h1><p>State: ${phase}</p>
<p>Only this experiment is controlled here. The main Paseo daemon stays untouched.</p>
<form method="post" action="/stop"><input type="hidden" name="token" value="${stopToken}"><button>Stop / Take control</button></form>
${
  phase === "human"
    ? `<h2>Your turn in Chrome</h2><p>Automation is paused, including screenshots and snapshots. In the proof's webauthn.io tab, register a disposable username if needed and save its passkey in 1Password, then authenticate with that passkey. If already logged in, select “Try it again?” and authenticate afresh. Leave the “You're logged in!” page visible.</p><p>The passkey remains in your vault until you remove it yourself.</p>
<form method="post" action="/continue"><input type="hidden" name="token" value="${token}"><label><input type="checkbox" name="fresh1password" value="yes" required>I completed a fresh passkey authentication using 1Password for this ${provider} step.</label><p><button>Continue this agent</button></p></form>`
    : "<p>Reload this page to see current status. Continue appears only after automation has drained.</p>"
}
</body></html>`;
  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    if (request.headers.host !== new URL(origin).host) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader("cache-control", "no-store");
    response.setHeader(
      "content-security-policy",
      "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    response.setHeader("x-content-type-options", "nosniff");
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html());
      return;
    }
    if (request.method !== "POST" || request.headers.origin !== origin) {
      response.writeHead(403).end();
      return;
    }
    const body = await formBody(request);
    if (body.get("token") !== (request.url === "/stop" ? stopToken : token)) {
      response.writeHead(409).end("Stale control form. Reload this page.");
      return;
    }
    if (request.url === "/stop") {
      await stop();
    } else if (
      request.url === "/continue" &&
      phase === "human" &&
      body.get("fresh1password") === "yes"
    ) {
      phase = "resuming";
      token = randomUUID();
      holdPromise = undefined;
      await adapter.continueAfterHuman();
      // A Stop accepted during persistence wins over this Continue.
      if (String(phase) !== "resuming") {
        response.writeHead(303, { location: "/" }).end();
        return;
      }
      confirmedAt = new Date().toISOString();
      phase = "running";
      waiting?.();
      waiting = undefined;
    } else {
      response.writeHead(409).end("Action unavailable. Reload this page.");
      return;
    }
    response.writeHead(303, { location: "/" }).end();
  };
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end("Control action failed; automation must remain paused until recovery.");
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Control server did not bind");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: origin,
    begin(next: Provider) {
      if (phase === "stopping" || phase === "human" || phase === "resuming") {
        throw new Error("Human takeover prevents starting another provider");
      }
      provider = next;
      phase = "running";
      holdPromise = undefined;
      confirmedAt = undefined;
      token = randomUUID();
    },
    async waitForHuman() {
      await stop();
      await humanPromise; // No timeout or automatic return of human ownership.
      return confirmedAt;
    },
    async close() {
      phase = "finished";
      await new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function createProviderDaemon(provider: Provider, root: string, logger: pino.Logger) {
  const home = path.join(root, provider, "home");
  const cwd = path.join(root, provider, "workspace");
  const staticDir = path.join(root, provider, "static");
  await Promise.all(
    [home, cwd, staticDir].map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })),
  );
  const daemon = await createPaseoDaemon(
    {
      listen: "127.0.0.1:0",
      paseoHome: home,
      staticDir,
      corsAllowedOrigins: [],
      hostnames: true,
      mcpEnabled: true,
      mcpInjectIntoAgents: true,
      browserToolsEnabled: true,
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
  return { daemon, cwd };
}

async function connectHost(daemon: PaseoDaemon, adapter: Adapter) {
  const target = daemon.getListenTarget();
  if (!target || target.type !== "tcp") throw new Error("Proof daemon did not bind TCP");
  const registration = { hostKind: "desktop app", supportedCommands: [...commands] };
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${target.port}/ws`,
    appVersion: "0.14.0",
    clientType: "browser",
    clientId: `chrome-live-proof-${randomUUID()}`,
    reconnect: { enabled: false },
    capabilities: { [CLIENT_CAPS.browserHost]: registration },
  });
  const observed = { snapshotCount: 0, loggedIn: false };
  client.on("browser.automation.execute.request", (request) => {
    void adapter
      .execute(request, daemon.getServerId())
      .then((response) => {
        if (response.payload.ok && response.payload.result.command === "snapshot") {
          observed.snapshotCount += 1;
          observed.loggedIn =
            response.payload.result.snapshot.includes(successIndicator) &&
            new URL(response.payload.result.url).pathname === "/profile";
        }
        client.sendBrowserAutomationExecuteResponse(response);
        return undefined;
      })
      .catch(() => {
        client.sendBrowserAutomationExecuteResponse({
          type: "browser.automation.execute.response",
          payload: {
            requestId: request.requestId,
            ok: false,
            error: {
              code: "browser_denied",
              message: "Live proof paused or unavailable",
              retryable: false,
            },
          },
        });
      });
  });
  await client.connect();
  await client.fetchAgents({ subscribe: {} });
  const observation = client.registerBrowserHost(registration);
  await observation.ready;
  return { client, observation, observed };
}

async function providerTurn(daemon: PaseoDaemon, agentId: string, prompt: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      daemon.agentManager.runAgent(agentId, prompt),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Provider turn exceeded 180 seconds")), 180_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runLiveChromeProof() {
  if (process.env.PASEO_CHROME_LIVE_PROOF !== "1") throw new Error("Set PASEO_CHROME_LIVE_PROOF=1");
  const base = path.resolve(process.env.A2_PROOF_ROOT ?? ".dev/chrome-proof");
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "live-"));
  const models = { claude: required("A2_CLAUDE_MODEL"), codex: required("A2_CODEX_MODEL") };
  const adapter = createChromeProofAdapter({
    agentBrowserPath: required("A2_AGENT_BROWSER_PATH"),
    cdpEndpoint: loopbackCdpEndpoint(),
    fixtureUrl: site,
    stateDir: path.join(root, "adapter"),
    mode: "human-login",
    lockPath: path.join(os.homedir(), ".cache/paseo-chrome-proof-owner"),
  });
  const control = await createControl(adapter);
  const logger = pino({ level: "warn" }, pino.destination(path.join(root, "daemon.log")));
  const daemons: PaseoDaemon[] = [];
  const hosts: Array<Awaited<ReturnType<typeof connectHost>>> = [];
  const agents: Array<{ daemon: PaseoDaemon; agentId: string }> = [];
  const results: Array<Record<string, unknown>> = [];
  let completed = false;
  const cleanupErrors: string[] = [];
  console.log(
    JSON.stringify({
      event: "live_proof_started",
      controlUrl: control.url,
      evidenceDirectory: root,
    }),
  );
  try {
    for (const provider of ["claude", "codex"] as const) {
      const { daemon, cwd } = await createProviderDaemon(provider, root, logger);
      daemons.push(daemon);
      await daemon.start();
      const host = await connectHost(daemon, adapter);
      hosts.push(host);
      const workspace = await host.client.createWorkspace({
        source: { kind: "directory", path: cwd },
      });
      if (!workspace.workspace) throw new Error("Proof workspace creation failed");
      const agent = await host.client.createAgent({
        workspaceId: workspace.workspace.id,
        config: {
          provider,
          cwd,
          model: models[provider],
          modeId: provider === "claude" ? "bypassPermissions" : "full-access",
        },
      });
      agents.push({ daemon, agentId: agent.id });
      await adapter.admitOwner({
        serverId: daemon.getServerId(),
        agentId: agent.id,
        workspaceId: workspace.workspace.id,
      });
      control.begin(provider);
      const opened = await providerTurn(
        daemon,
        agent.id,
        `Use only Paseo browser tools (tool discovery allowed). Open ${site} with browser_new_tab, then browser_snapshot once. Do not click, fill, type, navigate, capture any other tab, run shell commands, or use other tools. Authentication belongs to the human. Finish with AUTH_WAIT.`,
      );
      if (!opened.finalText.includes("AUTH_WAIT") || host.observed.snapshotCount < 1)
        throw new Error("Provider did not reach authentication handoff");
      const initiallyLoggedIn = host.observed.loggedIn;
      const humanConfirmedAt = await control.waitForHuman();
      const snapshotsBeforeResume = host.observed.snapshotCount;
      const resumed = await providerTurn(
        daemon,
        agent.id,
        `The human explicitly returned control after authentication. Use only browser_snapshot on your existing browserId (browser_list_tabs allowed if needed), with no clicks or navigation. Inspect the actual current page. If the page visibly says "${successIndicator}", reply AUTH_OK and quote only that nonsecret heading. Otherwise reply AUTH_NOT_CONFIRMED. Never infer which password manager or authenticator was used.`,
      );
      const verified =
        host.observed.snapshotCount > snapshotsBeforeResume &&
        host.observed.loggedIn &&
        resumed.finalText.includes("AUTH_OK");
      results.push({
        provider,
        model: models[provider],
        agentId: agent.id,
        serverId: daemon.getServerId(),
        initiallyLoggedIn,
        humanConfirmedFresh1Password: Boolean(humanConfirmedAt),
        humanConfirmedAt,
        verified,
        observedIndicator: verified ? successIndicator : null,
        verifiedAt: new Date().toISOString(),
      });
      await writeFile(
        path.join(root, "proof.json"),
        JSON.stringify({ completed: false, realRemoteNetworkVerified: false, results }, null, 2),
        { mode: 0o600 },
      );
      if (!verified) throw new Error("Post-authentication browser snapshot did not prove login");
      await adapter.releaseOwner();
      console.log(
        JSON.stringify({
          event: "provider_live_proof_complete",
          provider,
          verified,
          observedIndicator: successIndicator,
        }),
      );
    }
    completed = true;
  } finally {
    for (const { daemon, agentId } of agents)
      await daemon.agentManager.cancelAgentRun(agentId).catch(() => {
        cleanupErrors.push("agent cancellation");
      });
    await adapter.close().catch(() => {
      cleanupErrors.push("adapter recovery required");
    });
    for (const host of hosts) {
      await host.observation.release().catch(() => {
        cleanupErrors.push("host deregistration");
      });
      await host.client.close().catch(() => {
        cleanupErrors.push("host disconnect");
      });
    }
    for (const daemon of daemons)
      await daemon.stop().catch(() => {
        cleanupErrors.push("daemon stop");
      });
    await control.close();
    await writeFile(
      path.join(root, "proof.json"),
      JSON.stringify(
        {
          kind: "two-local-daemons-human-passkey-proof",
          completed: completed && cleanupErrors.length === 0,
          cleanupErrors,
          realRemoteNetworkVerified: false,
          passwordManagerEvidence: "human confirmation only",
          results,
          adapterEvidence: adapter.evidence,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    logger.flush();
  }
  if (cleanupErrors.length)
    throw new Error(`Live proof cleanup incomplete: ${cleanupErrors.join(", ")}`);
}

if (process.env.PASEO_CHROME_LIVE_PROOF === "1") {
  void runLiveChromeProof().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Live proof failed");
    process.exitCode = 1;
  });
}
