import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PaseoApi, PaseoNotificationSendResult } from "@getpaseo/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserBackend, Owner } from "../shared/model";
import { createService } from "./service";

const alice: Owner = { agentId: "alice", workspaceId: "a" };
const bob: Owner = { agentId: "bob", workspaceId: "b" };
const config = { enabled: true, binaryPath: "/test/agent-browser", cdpEndpoint: "9222" };
const cleanup: Array<() => Promise<void>> = [];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function setup(options: Parameters<typeof createService>[0] = {}) {
  const directory = await mkdtemp(join(tmpdir(), "control-service-"));
  await writeFile(join(directory, "config.json"), JSON.stringify(config));
  const backend: BrowserBackend = {
    open: vi.fn(async () => ({ targetId: "target" })),
    execute: vi.fn(async () => ({ text: "snapshot" })),
    close: vi.fn(async () => {}),
    recover: vi.fn(async () => {}),
  };
  const service = await createService({
    directory,
    lockPath: join(directory, "lock"),
    createBackend: () => backend,
    wakeIntervalMs: 10,
    ...options,
  });
  cleanup.push(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });
  const send = vi.fn(async () => ({}));
  const notify = vi.fn(async (): Promise<PaseoNotificationSendResult> => ({ delivered: true }));
  const api = {
    agents: { ref: vi.fn(() => ({ send })) },
    notifications: { send: notify },
  } as unknown as PaseoApi;
  service.attachPaseo(api);
  return { service, backend, send, notify, api };
}
afterEach(async () => {
  for (const dispose of cleanup.splice(0).toReversed()) await dispose();
});

describe("computer control service integration", () => {
  it("does not admit a request while disabling configuration is being committed", async () => {
    const writing = deferred();
    const commit = deferred();
    const { service, backend } = await setup({
      writeConfig: async () => {
        writing.resolve();
        await commit.promise;
      },
    });
    const changing = service.configure({ ...config, enabled: false });
    await writing.promise;
    const request = service.request(alice, "Browse", "https://example.com/", "a");
    const rejected = expect(request).rejects.toThrow("disabled");
    expect(backend.open).not.toHaveBeenCalled();
    commit.resolve();
    await changing;
    await rejected;
    expect(backend.open).not.toHaveBeenCalled();
  });

  it("rejects reconfiguration queued behind a task admission", async () => {
    const opening = deferred();
    const opened = deferred();
    const backend: BrowserBackend = {
      open: vi.fn(async () => {
        opening.resolve();
        await opened.promise;
        return { targetId: "target" };
      }),
      execute: vi.fn(async () => ({ text: "" })),
      close: vi.fn(async () => {}),
      recover: vi.fn(async () => {}),
    };
    const { service } = await setup({ createBackend: () => backend });
    const request = service.request(alice, "Browse", "https://example.com/", "a");
    await opening.promise;
    const changing = service.configure({ ...config, cdpEndpoint: "9333" });
    const rejected = expect(changing).rejects.toThrow("Finish or recover");
    opened.resolve();
    await request;
    await rejected;
    expect(service.config.cdpEndpoint).toBe("9222");
  });

  it("observes autonomous queue promotion and deduplicates against explicit after", async () => {
    const { service, api, send } = await setup();
    const first = await service.request(alice, "First", "https://example.com/", "a");
    const second = await service.request(bob, "Second", "https://example.org/", "b");
    const previous = service.engine.inspect();
    const sending = deferred();
    send.mockImplementation(async () => {
      await sending.promise;
      return {};
    });
    // A timer-driven engine transition has no service.after call.
    await service.engine.finish(alice, first.id);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const explicit = service.after(previous, api);
    sending.resolve();
    await explicit;
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.stringContaining(second.id), {
      activeTurnBehavior: "steer",
    });
  });

  it("reports a failed wake without repeatedly sending on every observation", async () => {
    const { service, api, send } = await setup();
    const first = await service.request(alice, "First", "https://example.com/", "a");
    await service.request(bob, "Second", "https://example.org/", "b");
    const previous = service.engine.inspect();
    send.mockRejectedValue(new Error("offline"));
    await service.engine.finish(alice, first.id);
    await service.after(previous, api);
    await service.after(previous, api);
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(send).toHaveBeenCalledTimes(1);
    expect(service.error).toContain("could not be notified");
  });
  it.each([
    ["muted", "muted"],
    ["rate_limited", "rate limit"],
    [undefined, "not confirmed"],
    ["duplicate", "earlier delivery is unconfirmed"],
  ])(
    "reports %s notification delivery without releasing human control",
    async (dropped, expected) => {
      const { service, notify, api } = await setup();
      const active = await service.request(alice, "Login", "https://example.com/", "login");
      const held = await service.engine.handoff(alice, active.id, "Authenticate");
      notify.mockResolvedValue({ delivered: false, dropped });
      await service.attention(held, api);
      expect(service.error).toContain(expected);
      expect(service.engine.inspect()[0].state).toBe("human");
    },
  );

  it("accepts deduplication after acknowledged delivery of the same handoff", async () => {
    const { service, notify, api } = await setup();
    const active = await service.request(alice, "Login", "https://example.com/", "login");
    const held = await service.engine.handoff(alice, active.id, "Authenticate");
    await service.attention(held, api);
    notify.mockResolvedValue({ delivered: false, dropped: "duplicate" });
    await service.attention(held, api);
    expect(service.error).toBeNull();
    expect(service.engine.inspect()[0].state).toBe("human");
  });
});
