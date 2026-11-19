import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "../shared/model";
import { createBrowserBackend, localEndpoint } from "./browser";

const task: Task = {
  id: "task-1",
  agentId: "agent-1",
  workspaceId: "workspace-1",
  title: "Test",
  url: "https://example.com/",
  state: "active",
  revision: 1,
  createdAt: "2026-11-19T00:00:00Z",
  session: "paseo-control-test",
  cancelRequested: false,
};
const options = {
  binaryPath: "/opt/agent-browser",
  cdpEndpoint: "9222",
  socketDir: "/tmp/control-browser-test",
};
const success = (data: Record<string, unknown>) => JSON.stringify({ success: true, data });

describe("computer control browser adapter", () => {
  it.runIf(process.platform === "darwin" || process.platform === "linux")(
    "recovers an uncreatable socket path only after confirming the executor is absent",
    async () => {
      const server = createServer();
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test port");
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        }),
      );
      const directory = await mkdtemp(join(tmpdir(), `paseo-control-${"x".repeat(90)}-`));
      try {
        const browser = createBrowserBackend({
          ...options,
          cdpEndpoint: String(address.port),
          socketDir: directory,
        });
        await expect(browser.recover(task)).resolves.toBeUndefined();
        await writeFile(join(directory, `${task.session}.pid`), String(process.pid));
        await expect(browser.recover(task)).rejects.toThrow("Stop the owned agent-browser session");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
  it("accepts only explicit numeric loopback endpoints", () => {
    expect(localEndpoint("9222")).toEqual({
      endpoint: "http://127.0.0.1:9222",
      host: "127.0.0.1",
      port: 9222,
    });
    expect(localEndpoint("ws://[::1]:9222/devtools/browser/id").host).toBe("::1");
    for (const endpoint of [
      "https://example.com",
      "http://localhost:9222",
      "http://127.0.0.2:9222",
      "ws://user:secret@127.0.0.1:9222/id",
      "file:///tmp/chrome",
      "http://127.0.0.1:9222/?token=secret",
      "0",
      "65536",
    ])
      expect(() => localEndpoint(endpoint)).toThrow();
  });

  it("uses explicit pinning for a new tab and every action; never exposes arbitrary arguments", async () => {
    const run = vi.fn(async (_args: string[]) =>
      success({ targetId: "TARGET1", snapshot: "button Continue [ref=e1]" }),
    );
    const browser = createBrowserBackend(options, { runCommand: run });
    expect(await browser.open(task)).toEqual({ targetId: "TARGET1" });
    const owned = { ...task, targetId: "TARGET1" };
    expect(await browser.execute(owned, { kind: "snapshot" })).toEqual({
      text: "button Continue [ref=e1]",
    });
    await browser.execute(owned, { kind: "click", ref: "e1" });
    await browser.execute(owned, { kind: "fill", ref: "@e1", text: "literal $(no-shell)" });
    const prefix = [
      "--session",
      task.session,
      "--cdp",
      "http://127.0.0.1:9222",
      "--pin-tab",
      "--json",
      "--config",
      "/tmp/control-browser-test/empty-config.json",
    ];
    expect(run.mock.calls[0]?.[0]).toEqual([...prefix, "open", task.url]);
    expect(run.mock.calls[2]?.[0]).toEqual([...prefix, "click", "@e1"]);
    expect(run.mock.calls[3]?.[0]).toEqual([...prefix, "fill", "@e1", "literal $(no-shell)"]);
  });

  it("rejects foreign targets and malformed output without leaking backend errors", async () => {
    const run = vi.fn(async (_args: string[]) =>
      success({ targetId: "FOREIGN", snapshot: "secret" }),
    );
    const browser = createBrowserBackend(options, { runCommand: run });
    await expect(
      browser.execute({ ...task, targetId: "TARGET1" }, { kind: "snapshot" }),
    ).rejects.toThrow("recovery is required");
    run.mockRejectedValueOnce(new Error("fill @e1 password-secret"));
    await expect(
      browser.execute(
        { ...task, targetId: "TARGET1" },
        { kind: "fill", ref: "e1", text: "password-secret" },
      ),
    ).rejects.toThrow(/^Browser command failed or execution is uncertain; recovery is required$/);
  });

  it("rejects dangerous page URLs, refs and shortcuts before dispatch", async () => {
    const run = vi.fn(async (_args: string[]) => success({}));
    const browser = createBrowserBackend(options, { runCommand: run });
    const owned = { ...task, targetId: "TARGET1" };
    await expect(browser.open({ ...task, url: "javascript:alert(1)" })).rejects.toThrow();
    await expect(
      browser.execute(owned, { kind: "navigate", url: "https://user:password@example.com" }),
    ).rejects.toThrow();
    await expect(browser.execute(owned, { kind: "click", ref: "--help" })).rejects.toThrow();
    await expect(browser.execute(owned, { kind: "press", key: "Meta+w" })).rejects.toThrow();
    await expect(
      browser.execute(owned, { kind: "scroll", direction: "down", pixels: 5000 }),
    ).rejects.toThrow();
    await expect(browser.open({ ...task, session: "../../default" })).rejects.toThrow();
    await expect(
      browser.execute(owned, { kind: "fill", ref: "e1", text: "--profile" }),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it("closes only its recorded target before detaching its session", async () => {
    const run = vi.fn(async (_args: string[]) => success({}));
    const browser = createBrowserBackend(options, { runCommand: run });
    await browser.close({ ...task, targetId: "TARGET1" });
    expect(run.mock.calls.map(([args]) => args.slice(8))).toEqual([
      ["tab", "close", "TARGET1"],
      ["close"],
    ]);
  });

  it("does not pretend recovery succeeded while a command is pending or disconnected evidence fails", async () => {
    let resolve!: (value: string) => void;
    const run = vi.fn(
      (_args: string[]) =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const disconnected = vi.fn(async () => {
      throw new Error("Endpoint remains connected");
    });
    const browser = createBrowserBackend(options, {
      runCommand: run,
      assertDisconnected: disconnected,
    });
    const opening = browser.open(task);
    await expect(browser.recover(task)).rejects.toThrow("still pending");
    expect(disconnected).not.toHaveBeenCalled();
    resolve(success({ targetId: "TARGET1" }));
    await opening;
    await expect(browser.recover(task)).rejects.toThrow("Endpoint remains connected");
    expect(run).toHaveBeenCalledTimes(1);
  });
});
