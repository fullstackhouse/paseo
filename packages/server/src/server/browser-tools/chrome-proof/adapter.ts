import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type {
  BrowserAutomationExecuteRequest,
  BrowserAutomationExecuteResponse,
  BrowserAutomationResult,
} from "@getpaseo/protocol/browser-automation/rpc-schemas";

const exec = promisify(execFile);
interface Owner {
  serverId: string;
  agentId: string;
  workspaceId: string;
}
interface Output {
  success: boolean;
  error?: string;
  data: {
    snapshot?: string;
    refs?: Record<string, unknown>;
    url?: string;
    title?: string;
    targetId?: string;
  };
}

/** Opt-in feasibility proof. This is not the proposed production Chrome adapter. */
export function createChromeProofAdapter(
  options: {
    agentBrowserPath: string;
    cdpEndpoint: string;
    fixtureUrl: string;
    stateDir: string;
    mode?: "fixture" | "human-login";
    lockPath?: string;
  },
  dependencies?: { runCommand: (args: string[]) => Promise<string> },
) {
  if (options.mode === "human-login" && !options.lockPath) {
    throw new Error("Human-login proof requires a user-wide exclusive lock");
  }
  const lockIdentity = randomUUID();
  let lockHeld = false;
  let closing = false;
  let hold: Promise<void> | undefined;
  let owner: Owner | undefined;
  let session = "";
  let browserId = "";
  let targetId = "";
  let currentUrl = options.fixtureUrl;
  let failed = false;
  let lifecycle:
    | "released"
    | "admitting"
    | "active"
    | "stopping"
    | "holding"
    | "human_control"
    | "resuming" = "released";
  let cleanup: Promise<void> | undefined;
  let lane: Promise<void> = Promise.resolve();
  const receipts = new Map<
    string,
    { fingerprint: string; result: Promise<BrowserAutomationExecuteResponse> }
  >();
  const evidence: Array<{ serverId: string; command: string; event: string; at: string }> = [];
  const statePath = join(options.stateDir, "adapter-state.json");

  async function persist(state: string) {
    await mkdir(options.stateDir, { recursive: true });
    const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify({ state, browserId }), { mode: 0o600 });
    await rename(temporaryPath, statePath);
  }

  async function acquireLock() {
    if (!options.lockPath || lockHeld) return;
    await mkdir(dirname(options.lockPath), { recursive: true });
    // No stale-lock stealing: a dead helper may have left native/browser work running.
    await mkdir(options.lockPath, { mode: 0o700 });
    lockHeld = true;
    await writeFile(
      join(options.lockPath, "owner.json"),
      JSON.stringify({ identity: lockIdentity, pid: process.pid }),
      { mode: 0o600 },
    );
  }

  async function releaseLock() {
    if (!options.lockPath || !lockHeld) return;
    const record = JSON.parse(await readFile(join(options.lockPath, "owner.json"), "utf8"));
    if (record.identity !== lockIdentity) throw new Error("Proof lock ownership changed");
    await rm(options.lockPath, { recursive: true });
    lockHeld = false;
  }

  function holdForHuman(): Promise<void> {
    if (hold && (lifecycle === "holding" || lifecycle === "human_control")) return hold;
    if (!owner || failed || closing || (lifecycle !== "active" && lifecycle !== "resuming"))
      return Promise.reject(new Error("Proof task cannot enter human control"));
    lifecycle = "holding";
    hold = (async () => {
      await lane;
      if (failed) throw new Error("Unknown execution; human handoff requires recovery");
      try {
        await persist("human_control");
        lifecycle = "human_control";
      } catch (error) {
        failed = true;
        throw error;
      }
    })();
    return hold;
  }

  async function continueAfterHuman() {
    if (failed || closing || lifecycle !== "human_control")
      throw new Error("Proof task is not held for human control");
    lifecycle = "resuming";
    hold = undefined;
    const resume = (async () => {
      try {
        await persist("reserved");
        receipts.clear();
        // A local Stop that arrived during persistence wins over Continue.
        if (lifecycle === "resuming") lifecycle = "active";
      } catch (error) {
        failed = true;
        throw error;
      }
    })();
    lane = resume.catch(() => {
      failed = true;
    });
    await resume;
  }

  function checkedUrl(value: string | undefined): string {
    if (!value) throw new Error("Browser did not report a URL");
    if (options.mode !== "human-login") {
      if (value !== options.fixtureUrl) throw new Error("Target navigated away from fixture");
      return value;
    }
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin !== new URL(options.fixtureUrl).origin ||
      url.username ||
      url.password
    )
      throw new Error("Target navigated outside the enrolled login origin");
    // Auth redirects can contain transient data; it does not belong in proof output.
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  async function command(args: string[]): Promise<Output["data"]> {
    // Every invocation carries its explicit connection and sticky tab binding.
    const argv = [
      "--session",
      session,
      "--cdp",
      options.cdpEndpoint,
      "--pin-tab",
      "--json",
      ...args,
    ];
    const stdout = dependencies
      ? await dependencies.runCommand(argv)
      : (
          await exec(options.agentBrowserPath, argv, {
            timeout: 20_000,
            maxBuffer: 1024 * 1024,
            env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: "10000" },
          })
        ).stdout;
    const output = JSON.parse(stdout) as Output;
    if (!output.success) throw new Error("agent-browser operation failed");
    return output.data;
  }

  async function perform(
    request: BrowserAutomationExecuteRequest,
  ): Promise<BrowserAutomationResult> {
    const cmd = request.command;
    if (cmd.command === "new_tab") {
      if (browserId || cmd.args.url !== options.fixtureUrl)
        throw new Error("Only one fixture tab is allowed");
      const data = await command(["open", options.fixtureUrl]);
      if (!data.targetId) throw new Error("Unexpected browser target");
      currentUrl = checkedUrl(data.url);
      targetId = data.targetId;
      browserId = randomUUID();
      return {
        command: "new_tab",
        browserId,
        workspaceId: owner!.workspaceId,
        url: currentUrl,
      };
    }
    if (cmd.command === "list_tabs") {
      return {
        command: "list_tabs",
        tabs: browserId
          ? [
              {
                browserId,
                workspaceId: owner!.workspaceId,
                title: "Chrome proof",
                url: currentUrl,
                isActive: true,
                isLoading: false,
              },
            ]
          : [],
      };
    }
    if (!("browserId" in cmd.args) || cmd.args.browserId !== browserId || !targetId)
      throw new Error("Foreign target");
    // Pinning rejects a closed tab; checking URL prevents following a moved target.
    const location = await command(["get", "url"]);
    currentUrl = checkedUrl(location.url);
    if (cmd.command === "snapshot") {
      const data = await command(["snapshot"]);
      const snapshot = data.snapshot ?? "";
      return {
        command: "snapshot",
        browserId,
        workspaceId: owner!.workspaceId,
        url: currentUrl,
        title: "Chrome proof",
        format: "aria-yaml",
        snapshot,
        truncated: false,
        stats: {
          nodeCount: snapshot.split("\n").length,
          refCount: Object.keys(data.refs ?? {}).length,
          textLength: snapshot.length,
        },
      };
    }
    if (cmd.command === "click") {
      await command(["click", cmd.args.ref]);
      return { command: "click", browserId, ref: cmd.args.ref };
    }
    throw new Error("Command outside fixture proof allowlist");
  }

  function finish(): Promise<void> {
    if (lifecycle === "holding" || lifecycle === "human_control" || lifecycle === "resuming")
      return Promise.reject(
        new Error("Human control must be returned explicitly before releasing ownership"),
      );
    if (lifecycle === "released" && !owner) return Promise.resolve();
    if (cleanup) return cleanup;
    // Close admission before taking the lane snapshot. Queued calls recheck this state.
    const wasAdmitting = lifecycle === "admitting";
    lifecycle = "stopping";
    cleanup = (async () => {
      await lane;
      if (wasAdmitting || failed) throw new Error("Unknown execution; ownership transfer blocked");
      try {
        // The live mode admits observation only; it never starts a native auth operation.
        if (targetId) await command(["tab", "close", targetId]);
        if (session) await command(["close"]);
        await persist("released");
        owner = undefined;
        lifecycle = "released";
      } catch (error) {
        failed = true;
        await persist("recovery_required");
        throw error;
      }
    })();
    return cleanup;
  }

  return {
    evidence,
    holdForHuman,
    stop: holdForHuman,
    continueAfterHuman,
    async admitOwner(next: Owner) {
      if (closing || lifecycle !== "released" || owner || failed)
        throw new Error("Adapter already reserved or needs recovery");
      // Reserve synchronously: another admission cannot pass while disk I/O is pending.
      lifecycle = "admitting";
      cleanup = undefined;
      const admission = (async () => {
        await acquireLock();
        await mkdir(options.stateDir, { recursive: true });
        const previous = await readFile(statePath, "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return "";
          throw error;
        });
        if (previous && JSON.parse(previous).state !== "released")
          throw new Error("Previous execution requires recovery");
        owner = { ...next };
        browserId = "";
        targetId = "";
        currentUrl = options.fixtureUrl;
        session = `paseo-proof-${randomUUID()}`;
        receipts.clear();
        await persist("reserved");
        if (lifecycle === "admitting") lifecycle = "active";
      })();
      lane = admission.catch(() => {
        failed = true;
      });
      try {
        await admission;
      } catch (error) {
        failed = true;
        throw error;
      }
    },
    execute(
      request: BrowserAutomationExecuteRequest,
      serverId: string,
    ): Promise<BrowserAutomationExecuteResponse> {
      const admitted = owner;
      const denied = (): BrowserAutomationExecuteResponse => ({
        type: "browser.automation.execute.response",
        payload: {
          requestId: request.requestId,
          ok: false,
          error: {
            code: "browser_denied",
            message:
              "Proof task does not own the adapter, request ID conflicts, or recovery is required",
            retryable: false,
          },
        },
      });
      if (
        !admitted ||
        (options.mode === "human-login" &&
          !["list_tabs", "new_tab", "snapshot"].includes(request.command.command)) ||
        lifecycle !== "active" ||
        failed ||
        serverId !== admitted.serverId ||
        request.agentId !== admitted.agentId ||
        request.workspaceId !== admitted.workspaceId
      )
        return Promise.resolve(denied());
      const key = JSON.stringify([serverId, request.requestId]);
      const fingerprint = JSON.stringify(request.command, (_key, value: unknown) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return value;
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
      });
      const existing = receipts.get(key);
      if (existing)
        return existing.fingerprint === fingerprint ? existing.result : Promise.resolve(denied());
      // Freeze accepted arguments so caller mutation cannot change the queued operation.
      const accepted = structuredClone(request);
      const result = lane.then(async (): Promise<BrowserAutomationExecuteResponse> => {
        if (lifecycle !== "active" || failed || owner !== admitted) return denied();
        try {
          await persist("dispatching");
          if (lifecycle !== "active") return denied();
          evidence.push({
            serverId,
            command: accepted.command.command,
            event: "dispatch",
            at: new Date().toISOString(),
          });
          const value = await perform(accepted);
          await persist("reserved");
          evidence.push({
            serverId,
            command: accepted.command.command,
            event: "complete",
            at: new Date().toISOString(),
          });
          return {
            type: "browser.automation.execute.response",
            payload: { requestId: accepted.requestId, ok: true, result: value },
          };
        } catch {
          failed = true;
          await persist("recovery_required");
          return denied();
        }
      });
      // Keep the lane awaitable even if persisting a failure itself fails.
      lane = result.then(
        () => undefined,
        () => {
          failed = true;
        },
      );
      receipts.set(key, { fingerprint, result });
      return result;
    },
    releaseOwner: finish,
    async close() {
      // A human hold survives even an attempted shutdown; do not revoke it implicitly.
      if (lifecycle === "holding" || lifecycle === "human_control" || lifecycle === "resuming")
        throw new Error("Human control must be returned explicitly before closing");
      closing = true;
      await finish();
      if (failed) throw new Error("Unknown execution; proof lock retained");
      try {
        await releaseLock();
      } catch (error) {
        failed = true;
        await persist("recovery_required");
        throw error;
      }
    },
  };
}
