import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  BrowserAutomationCommand,
  BrowserAutomationCommandName,
  BrowserAutomationExecuteRequest,
  BrowserAutomationExecuteResponse,
} from "@getpaseo/protocol/browser-automation/rpc-schemas";
import { BROWSER_AUTOMATION_COMMAND_NAMES } from "@getpaseo/protocol/browser-automation/rpc-schemas";
import type { BrowserHostLiveOutboundMessage } from "@getpaseo/protocol/browser-automation/live-view";
import {
  decodeBrowserLiveFrameHeader,
  encodeBrowserLiveFrame,
} from "@getpaseo/protocol/binary-frames/browser-live";
import {
  BrowserToolsBroker,
  type BrowserHostClient,
  type BrowserLiveViewSink,
  type BrowserLiveViewStartResult,
} from "./broker.js";

const BROWSER_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_BROWSER_ID = "22222222-2222-4222-8222-222222222222";

class FakeBrowserHostClient implements BrowserHostClient {
  public readonly receivedRequests: BrowserAutomationExecuteRequest[] = [];
  public readonly hostKind: string;
  public readonly supportedCommands: readonly BrowserAutomationCommandName[];

  public constructor(
    public readonly id: string,
    options: {
      hostKind?: string;
      supportedCommands?: readonly BrowserAutomationCommandName[];
    } = {},
  ) {
    this.hostKind = options.hostKind ?? "desktop app";
    this.supportedCommands = options.supportedCommands ?? [...BROWSER_AUTOMATION_COMMAND_NAMES];
  }

  public sendBrowserAutomationRequest(request: BrowserAutomationExecuteRequest): void {
    this.receivedRequests.push(request);
  }

  public resolveLatestWith(
    broker: BrowserToolsBroker,
    responsePayload: BrowserAutomationExecuteResponse["payload"],
  ): boolean {
    const latest = this.receivedRequests.at(-1);
    if (!latest) {
      throw new Error(`Host ${this.id} has not received a browser request.`);
    }
    return this.resolveRequestWith(broker, latest, responsePayload);
  }

  public resolveRequestWith(
    broker: BrowserToolsBroker,
    request: BrowserAutomationExecuteRequest,
    responsePayload: BrowserAutomationExecuteResponse["payload"],
  ): boolean {
    return broker.receiveResponse({
      type: "browser.automation.execute.response",
      payload: { ...responsePayload, requestId: request.requestId },
    });
  }
}

class FailingBrowserHostClient implements BrowserHostClient {
  public readonly id = "host-1";
  public readonly hostKind = "desktop app";
  public readonly supportedCommands = [...BROWSER_AUTOMATION_COMMAND_NAMES];

  public sendBrowserAutomationRequest(): void {
    throw new Error("websocket send failed");
  }
}

function createBroker(options: { timeoutMs?: number } = {}): BrowserToolsBroker {
  return new BrowserToolsBroker({
    defaultTimeoutMs: options.timeoutMs ?? 100,
    createRequestId: () => "req-1",
  });
}

function snapshotCommand(): BrowserAutomationCommand {
  return { command: "snapshot", args: { browserId: BROWSER_ID } };
}

describe("BrowserToolsBroker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("no connected browser host returns a retryable browser_no_host error", async () => {
    const broker = createBroker();

    await expect(broker.execute({ command: snapshotCommand() })).resolves.toEqual({
      requestId: "req-1",
      ok: false,
      error: {
        code: "browser_no_host",
        message: "No browser automation host is connected.",
        retryable: true,
      },
    });
  });

  test("invalid browser requests return structured failures without contacting a host", async () => {
    const broker = createBroker();
    const client = new FakeBrowserHostClient("host-1");
    broker.registerClient(client);

    await expect(
      broker.execute({
        command: {
          command: "new_tab",
          args: { url: "ftp://example.com" },
        } as unknown as BrowserAutomationCommand,
      }),
    ).resolves.toEqual({
      requestId: "req-1",
      ok: false,
      error: {
        code: "browser_unknown_error",
        message: "Browser automation request is invalid: URL must use http or https.",
        retryable: false,
      },
    });
    expect(client.receivedRequests).toEqual([]);
    expect(broker.getPendingRequestCount()).toBe(0);
  });

  test("capable browser host receives request and returns response", async () => {
    const broker = createBroker();
    const client = new FakeBrowserHostClient("host-1");
    broker.registerClient(client);

    const resultPromise = broker.execute({
      command: { command: "list_tabs", args: {} },
      workspaceId: "workspace-1",
    });

    expect(client.receivedRequests).toEqual([
      {
        type: "browser.automation.execute.request",
        requestId: "req-1",
        workspaceId: "workspace-1",
        command: { command: "list_tabs", args: {} },
      },
    ]);
    expect(broker.getPendingRequestCount()).toBe(1);

    expect(
      client.resolveLatestWith(broker, {
        requestId: "req-1",
        ok: true,
        result: {
          command: "list_tabs",
          tabs: [
            {
              browserId: BROWSER_ID,
              workspaceId: "workspace-1",
              url: "https://example.com",
              title: "Example",
            },
          ],
        },
      }),
    ).toBe(true);

    await expect(resultPromise).resolves.toEqual({
      requestId: "req-1",
      ok: true,
      result: {
        command: "list_tabs",
        tabs: [
          {
            browserId: BROWSER_ID,
            workspaceId: "workspace-1",
            url: "https://example.com",
            title: "Example",
            isActive: false,
            isLoading: false,
          },
        ],
      },
    });
    expect(broker.getPendingRequestCount()).toBe(0);
  });

  test("single browser host receives snapshot requests", async () => {
    const broker = createBroker();
    const client = new FakeBrowserHostClient("host-1");
    broker.registerClient(client);

    const resultPromise = broker.execute({
      command: { command: "snapshot", args: { browserId: BROWSER_ID } },
      workspaceId: "workspace-1",
    });

    expect(client.receivedRequests).toEqual([
      {
        type: "browser.automation.execute.request",
        requestId: "req-1",
        workspaceId: "workspace-1",
        command: { command: "snapshot", args: { browserId: BROWSER_ID } },
      },
    ]);

    client.resolveLatestWith(broker, {
      requestId: "req-1",
      ok: true,
      result: {
        command: "snapshot",
        browserId: BROWSER_ID,
        workspaceId: "workspace-1",
        url: "https://example.com",
        title: "Example",
        format: "aria-yaml",
        snapshot: "- document",
        truncated: false,
        stats: { nodeCount: 1, refCount: 0, textLength: 10 },
      },
    });

    await expect(resultPromise).resolves.toEqual({
      requestId: "req-1",
      ok: true,
      result: {
        command: "snapshot",
        browserId: BROWSER_ID,
        workspaceId: "workspace-1",
        url: "https://example.com",
        title: "Example",
        format: "aria-yaml",
        snapshot: "- document",
        truncated: false,
        stats: { nodeCount: 1, refCount: 0, textLength: 10 },
      },
    });
  });

  test("new tabs target the most recently registered host and tab commands stay with that host", async () => {
    const broker = createBroker();
    const firstHost = new FakeBrowserHostClient("host-1");
    const recentHost = new FakeBrowserHostClient("host-2");
    broker.registerClient(firstHost);
    broker.registerClient(recentHost);

    const newTabPromise = broker.execute({
      command: { command: "new_tab", args: { url: "https://example.com" } },
      workspaceId: "workspace-1",
    });

    expect(firstHost.receivedRequests).toEqual([]);
    expect(recentHost.receivedRequests).toEqual([
      {
        type: "browser.automation.execute.request",
        requestId: "req-1",
        workspaceId: "workspace-1",
        command: { command: "new_tab", args: { url: "https://example.com" } },
      },
    ]);

    recentHost.resolveLatestWith(broker, {
      requestId: "req-1",
      ok: true,
      result: {
        command: "new_tab",
        browserId: BROWSER_ID,
        workspaceId: "workspace-1",
        url: "https://example.com",
      },
    });

    await expect(newTabPromise).resolves.toMatchObject({
      ok: true,
      result: { command: "new_tab", browserId: BROWSER_ID },
    });

    const snapshotPromise = broker.execute({
      command: { command: "snapshot", args: { browserId: BROWSER_ID } },
      workspaceId: "workspace-1",
    });

    expect(firstHost.receivedRequests).toEqual([]);
    expect(recentHost.receivedRequests.at(-1)).toEqual({
      type: "browser.automation.execute.request",
      requestId: "req-1",
      workspaceId: "workspace-1",
      command: { command: "snapshot", args: { browserId: BROWSER_ID } },
    });

    recentHost.resolveLatestWith(broker, {
      requestId: "req-1",
      ok: true,
      result: {
        command: "snapshot",
        browserId: BROWSER_ID,
        workspaceId: "workspace-1",
        url: "https://example.com",
        title: "Example",
        format: "aria-yaml",
        snapshot: "- document",
        truncated: false,
        stats: { nodeCount: 1, refCount: 0, textLength: 10 },
      },
    });

    await expect(snapshotPromise).resolves.toMatchObject({
      ok: true,
      result: { command: "snapshot", browserId: BROWSER_ID },
    });
  });

  test("list tabs aggregates all hosts and seeds browser id affinity", async () => {
    const broker = createBroker();
    const firstHost = new FakeBrowserHostClient("host-1");
    const secondHost = new FakeBrowserHostClient("host-2");
    broker.registerClient(firstHost);
    broker.registerClient(secondHost);

    const listPromise = broker.execute({
      command: { command: "list_tabs", args: {} },
      workspaceId: "workspace-1",
    });

    expect(firstHost.receivedRequests).toEqual([
      {
        type: "browser.automation.execute.request",
        requestId: "req-1:host-1",
        workspaceId: "workspace-1",
        command: { command: "list_tabs", args: {} },
      },
    ]);
    expect(secondHost.receivedRequests).toEqual([
      {
        type: "browser.automation.execute.request",
        requestId: "req-1:host-2",
        workspaceId: "workspace-1",
        command: { command: "list_tabs", args: {} },
      },
    ]);

    firstHost.resolveLatestWith(broker, {
      requestId: "req-1:host-1",
      ok: true,
      result: {
        command: "list_tabs",
        tabs: [
          {
            browserId: BROWSER_ID,
            workspaceId: "workspace-1",
            url: "https://one.example",
            title: "One",
          },
        ],
      },
    });
    secondHost.resolveLatestWith(broker, {
      requestId: "req-1:host-2",
      ok: true,
      result: {
        command: "list_tabs",
        tabs: [
          {
            browserId: SECOND_BROWSER_ID,
            workspaceId: "workspace-1",
            url: "https://two.example",
            title: "Two",
          },
        ],
      },
    });

    await expect(listPromise).resolves.toEqual({
      requestId: "req-1",
      ok: true,
      result: {
        command: "list_tabs",
        tabs: [
          {
            browserId: BROWSER_ID,
            workspaceId: "workspace-1",
            url: "https://one.example",
            title: "One",
            isActive: false,
            isLoading: false,
          },
          {
            browserId: SECOND_BROWSER_ID,
            workspaceId: "workspace-1",
            url: "https://two.example",
            title: "Two",
            isActive: false,
            isLoading: false,
          },
        ],
      },
    });

    const firstSnapshot = broker.execute({
      command: { command: "snapshot", args: { browserId: BROWSER_ID } },
      workspaceId: "workspace-1",
    });
    const secondSnapshot = broker.execute({
      command: { command: "snapshot", args: { browserId: SECOND_BROWSER_ID } },
      workspaceId: "workspace-1",
      requestId: "req-2",
    });

    expect(firstHost.receivedRequests.at(-1)?.command).toEqual({
      command: "snapshot",
      args: { browserId: BROWSER_ID },
    });
    expect(secondHost.receivedRequests.at(-1)?.command).toEqual({
      command: "snapshot",
      args: { browserId: SECOND_BROWSER_ID },
    });

    firstHost.resolveLatestWith(broker, {
      requestId: "req-1",
      ok: true,
      result: {
        command: "snapshot",
        browserId: BROWSER_ID,
        workspaceId: "workspace-1",
        url: "https://one.example",
        title: "One",
        format: "aria-yaml",
        snapshot: "- document",
        truncated: false,
        stats: { nodeCount: 1, refCount: 0, textLength: 10 },
      },
    });
    secondHost.resolveLatestWith(broker, {
      requestId: "req-2",
      ok: true,
      result: {
        command: "snapshot",
        browserId: SECOND_BROWSER_ID,
        workspaceId: "workspace-1",
        url: "https://two.example",
        title: "Two",
        format: "aria-yaml",
        snapshot: "- document",
        truncated: false,
        stats: { nodeCount: 1, refCount: 0, textLength: 10 },
      },
    });

    await expect(firstSnapshot).resolves.toMatchObject({
      ok: true,
      result: { command: "snapshot", browserId: BROWSER_ID },
    });
    await expect(secondSnapshot).resolves.toMatchObject({
      ok: true,
      result: { command: "snapshot", browserId: SECOND_BROWSER_ID },
    });
  });

  test.each([
    {
      name: "scroll",
      command: { command: "scroll", args: { browserId: BROWSER_ID, deltaX: 0, deltaY: 400 } },
      result: { command: "scroll", browserId: BROWSER_ID, deltaX: 0, deltaY: 400 },
    },
    {
      name: "resize",
      command: { command: "resize", args: { browserId: BROWSER_ID, width: 1024, height: 768 } },
      result: { command: "resize", browserId: BROWSER_ID, width: 1024, height: 768 },
    },
    {
      name: "close_tab",
      command: { command: "close_tab", args: { browserId: BROWSER_ID } },
      result: { command: "close_tab", browserId: BROWSER_ID },
    },
  ] satisfies Array<{
    name: string;
    command: BrowserAutomationCommand;
    result: BrowserAutomationExecuteResponse["payload"] extends infer Payload
      ? Payload extends { ok: true }
        ? Payload["result"]
        : never
      : never;
  }>)("routes $name to the host that owns the browser id", async ({ command, result }) => {
    const broker = createBroker();
    const other = new FakeBrowserHostClient("host-1");
    const owner = new FakeBrowserHostClient("host-2");
    broker.registerClient(other);
    broker.registerClient(owner);

    const newTabPromise = broker.execute({ command: { command: "new_tab", args: {} } });
    owner.resolveLatestWith(broker, {
      requestId: "req-1",
      ok: true,
      result: {
        command: "new_tab",
        browserId: BROWSER_ID,
        workspaceId: "workspace-1",
        url: "https://one.example",
      },
    });
    await newTabPromise;

    const resultPromise = broker.execute({ command, requestId: "req-command" });

    expect(owner.receivedRequests.at(-1)).toEqual({
      type: "browser.automation.execute.request",
      requestId: "req-command",
      command,
    });
    expect(other.receivedRequests).toEqual([]);

    owner.resolveLatestWith(broker, {
      requestId: "req-command",
      ok: true,
      result,
    });

    await expect(resultPromise).resolves.toEqual({
      requestId: "req-command",
      ok: true,
      result,
    });
  });

  test("successful close_tab clears browser id host affinity", async () => {
    const broker = createBroker();
    const other = new FakeBrowserHostClient("host-1");
    const owner = new FakeBrowserHostClient("host-2");
    broker.registerClient(other);
    broker.registerClient(owner);

    const newTabPromise = broker.execute({ command: { command: "new_tab", args: {} } });
    owner.resolveLatestWith(broker, {
      requestId: "req-1",
      ok: true,
      result: {
        command: "new_tab",
        browserId: BROWSER_ID,
        workspaceId: "workspace-1",
        url: "https://one.example",
      },
    });
    await newTabPromise;

    const closePromise = broker.execute({
      command: { command: "close_tab", args: { browserId: BROWSER_ID } },
      requestId: "req-close",
    });
    owner.resolveLatestWith(broker, {
      requestId: "req-close",
      ok: true,
      result: { command: "close_tab", browserId: BROWSER_ID },
    });
    await expect(closePromise).resolves.toMatchObject({
      ok: true,
      result: { command: "close_tab", browserId: BROWSER_ID },
    });

    await expect(
      broker.execute({
        command: { command: "snapshot", args: { browserId: BROWSER_ID } },
        requestId: "req-after-close",
      }),
    ).resolves.toEqual({
      requestId: "req-after-close",
      ok: false,
      error: {
        code: "browser_tab_not_found",
        message: `Browser tab ${BROWSER_ID} is not associated with a connected browser automation host. Call browser_list_tabs and use one of the returned browserId values.`,
        retryable: false,
      },
    });
    expect(owner.receivedRequests.at(-1)?.command).toEqual({
      command: "close_tab",
      args: { browserId: BROWSER_ID },
    });
    expect(other.receivedRequests).toEqual([]);
  });

  test("failed list tabs aggregation does not seed browser id affinity", async () => {
    const broker = createBroker();
    const firstHost = new FakeBrowserHostClient("host-1");
    const secondHost = new FakeBrowserHostClient("host-2");
    broker.registerClient(firstHost);
    broker.registerClient(secondHost);

    const listPromise = broker.execute({
      command: { command: "list_tabs", args: {} },
      workspaceId: "workspace-1",
    });

    firstHost.resolveLatestWith(broker, {
      requestId: "req-1:host-1",
      ok: true,
      result: {
        command: "list_tabs",
        tabs: [
          {
            browserId: BROWSER_ID,
            workspaceId: "workspace-1",
            url: "https://one.example",
            title: "One",
          },
        ],
      },
    });
    secondHost.resolveLatestWith(broker, {
      requestId: "req-1:host-2",
      ok: false,
      error: {
        code: "browser_timeout",
        message: "Host did not answer list_tabs.",
        retryable: true,
      },
    });

    await expect(listPromise).resolves.toEqual({
      requestId: "req-1",
      ok: false,
      error: {
        code: "browser_timeout",
        message: "Host did not answer list_tabs.",
        retryable: true,
      },
    });

    await expect(
      broker.execute({
        command: { command: "snapshot", args: { browserId: BROWSER_ID } },
        workspaceId: "workspace-1",
      }),
    ).resolves.toEqual({
      requestId: "req-1",
      ok: false,
      error: {
        code: "browser_tab_not_found",
        message: `Browser tab ${BROWSER_ID} is not associated with a connected browser automation host. Call browser_list_tabs and use one of the returned browserId values.`,
        retryable: false,
      },
    });
    expect(firstHost.receivedRequests).toHaveLength(1);
    expect(secondHost.receivedRequests).toHaveLength(1);
  });

  test("unsupported commands are rejected before sending to the routed host", async () => {
    const broker = createBroker();
    const client = new FakeBrowserHostClient("host-1", {
      supportedCommands: ["list_tabs"],
      hostKind: "desktop app",
    });
    broker.registerClient(client);

    await expect(broker.execute({ command: snapshotCommand() })).resolves.toEqual({
      requestId: "req-1",
      ok: false,
      error: {
        code: "browser_unsupported",
        message: 'Browser automation command "snapshot" is not supported by the desktop app.',
        retryable: false,
      },
    });
    await expect(
      broker.execute({
        command: {
          command: "evaluate",
          args: { browserId: BROWSER_ID, function: "() => document.title" },
        },
      }),
    ).resolves.toEqual({
      requestId: "req-1",
      ok: false,
      error: {
        code: "browser_unsupported",
        message: 'Browser automation command "evaluate" is not supported by the desktop app.',
        retryable: false,
      },
    });
    await expect(
      broker.execute({
        command: { command: "scroll", args: { browserId: BROWSER_ID, deltaX: 0, deltaY: 400 } },
      }),
    ).resolves.toEqual({
      requestId: "req-1",
      ok: false,
      error: {
        code: "browser_unsupported",
        message: 'Browser automation command "scroll" is not supported by the desktop app.',
        retryable: false,
      },
    });
    expect(client.receivedRequests).toEqual([]);
  });

  test("unregistering a host strands its browser ids instead of routing them to another host", async () => {
    const broker = createBroker();
    const owner = new FakeBrowserHostClient("host-1");
    const unregisterOwner = broker.registerClient(owner);

    const newTabPromise = broker.execute({
      command: { command: "new_tab", args: {} },
      workspaceId: "workspace-1",
    });
    owner.resolveLatestWith(broker, {
      requestId: "req-1",
      ok: true,
      result: {
        command: "new_tab",
        browserId: BROWSER_ID,
        workspaceId: "workspace-1",
        url: "https://example.com",
      },
    });
    await newTabPromise;

    unregisterOwner();
    const replacement = new FakeBrowserHostClient("host-2");
    broker.registerClient(replacement);

    await expect(
      broker.execute({
        command: { command: "snapshot", args: { browserId: BROWSER_ID } },
        workspaceId: "workspace-1",
      }),
    ).resolves.toEqual({
      requestId: "req-1",
      ok: false,
      error: {
        code: "browser_no_host",
        message: `The app hosting browser tab ${BROWSER_ID} disconnected.`,
        retryable: true,
      },
    });
    expect(replacement.receivedRequests).toEqual([]);
  });

  test("reconnecting the same host reclaims its stranded browser ids", async () => {
    const broker = createBroker();
    const owner = new FakeBrowserHostClient("host-1");
    const unregisterOwner = broker.registerClient(owner);

    const newTabPromise = broker.execute({
      command: { command: "new_tab", args: {} },
      workspaceId: "workspace-1",
    });
    owner.resolveLatestWith(broker, {
      requestId: "req-1",
      ok: true,
      result: {
        command: "new_tab",
        browserId: BROWSER_ID,
        workspaceId: "workspace-1",
        url: "https://example.com",
      },
    });
    await newTabPromise;

    unregisterOwner();
    const reconnectedOwner = new FakeBrowserHostClient("host-1");
    broker.registerClient(reconnectedOwner);

    const snapshotPromise = broker.execute({
      command: { command: "snapshot", args: { browserId: BROWSER_ID } },
      workspaceId: "workspace-1",
    });

    expect(reconnectedOwner.receivedRequests).toEqual([
      {
        type: "browser.automation.execute.request",
        requestId: "req-1",
        workspaceId: "workspace-1",
        command: { command: "snapshot", args: { browserId: BROWSER_ID } },
      },
    ]);
    reconnectedOwner.resolveLatestWith(broker, {
      requestId: "req-1",
      ok: true,
      result: {
        command: "snapshot",
        browserId: BROWSER_ID,
        workspaceId: "workspace-1",
        url: "https://example.com",
        title: "Example",
        format: "aria-yaml",
        snapshot: "- document",
        truncated: false,
        stats: { nodeCount: 1, refCount: 0, textLength: 10 },
      },
    });

    await expect(snapshotPromise).resolves.toMatchObject({
      ok: true,
      result: { command: "snapshot", browserId: BROWSER_ID },
    });
  });

  test("timeout resolves browser_timeout and clears pending state", async () => {
    vi.useFakeTimers();
    const broker = createBroker({ timeoutMs: 50 });
    broker.registerClient(new FakeBrowserHostClient("host-1"));

    const resultPromise = broker.execute({ command: snapshotCommand() });
    expect(broker.getPendingRequestCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(50);

    await expect(resultPromise).resolves.toEqual({
      requestId: "req-1",
      ok: false,
      error: {
        code: "browser_timeout",
        message: "Browser automation timed out after 50ms.",
        retryable: true,
      },
    });
    expect(broker.getPendingRequestCount()).toBe(0);
  });

  test("disconnect resolves retryable failure and clears pending request", async () => {
    const broker = createBroker();
    const client = new FakeBrowserHostClient("host-1");
    const unregister = broker.registerClient(client);

    const resultPromise = broker.execute({ command: snapshotCommand() });
    expect(broker.getPendingRequestCount()).toBe(1);

    unregister();

    await expect(resultPromise).resolves.toEqual({
      requestId: "req-1",
      ok: false,
      error: {
        code: "browser_no_host",
        message: "The browser automation host disconnected before responding.",
        retryable: true,
      },
    });
    expect(broker.getPendingRequestCount()).toBe(0);
  });

  test("replacing a host registration resolves pending requests from the old registration", async () => {
    const broker = createBroker();
    const oldHost = new FakeBrowserHostClient("host-1");
    const newHost = new FakeBrowserHostClient("host-1");
    broker.registerClient(oldHost);

    const pendingResult = broker.execute({ command: snapshotCommand() });
    expect(oldHost.receivedRequests).toHaveLength(1);
    expect(broker.getPendingRequestCount()).toBe(1);

    broker.registerClient(newHost);

    await expect(pendingResult).resolves.toEqual({
      requestId: "req-1",
      ok: false,
      error: {
        code: "browser_no_host",
        message: "The browser automation host disconnected before responding.",
        retryable: true,
      },
    });
    expect(broker.getPendingRequestCount()).toBe(0);

    const listResult = broker.execute({ command: { command: "list_tabs", args: {} } });
    expect(newHost.receivedRequests).toHaveLength(1);
    newHost.resolveLatestWith(broker, {
      requestId: "req-1",
      ok: true,
      result: { command: "list_tabs", tabs: [] },
    });

    await expect(listResult).resolves.toEqual({
      requestId: "req-1",
      ok: true,
      result: { command: "list_tabs", tabs: [] },
    });
  });

  test("browser host send failure resolves structured failure and clears pending request", async () => {
    const broker = createBroker();
    broker.registerClient(new FailingBrowserHostClient());

    await expect(broker.execute({ command: snapshotCommand() })).resolves.toEqual({
      requestId: "req-1",
      ok: false,
      error: {
        code: "browser_unknown_error",
        message: "Browser automation request failed to send: websocket send failed",
        retryable: false,
      },
    });
    expect(broker.getPendingRequestCount()).toBe(0);
  });

  test("explicit browser failure response propagates typed error", async () => {
    const broker = createBroker();
    const client = new FakeBrowserHostClient("host-1");
    broker.registerClient(client);

    const resultPromise = broker.execute({ command: snapshotCommand() });

    client.resolveLatestWith(broker, {
      requestId: "req-1",
      ok: false,
      error: {
        code: "browser_tab_not_found",
        message: `Browser tab ${BROWSER_ID} was not found.`,
        retryable: false,
      },
    });

    await expect(resultPromise).resolves.toEqual({
      requestId: "req-1",
      ok: false,
      error: {
        code: "browser_tab_not_found",
        message: `Browser tab ${BROWSER_ID} was not found.`,
        retryable: false,
      },
    });
    expect(broker.getPendingRequestCount()).toBe(0);
  });

  test("invalid browser response resolves a structured failure and clears pending state", async () => {
    const broker = createBroker();
    const client = new FakeBrowserHostClient("host-1");
    broker.registerClient(client);

    const resultPromise = broker.execute({ command: snapshotCommand() });
    expect(broker.getPendingRequestCount()).toBe(1);

    expect(
      broker.receiveResponse({
        type: "browser.automation.execute.response",
        payload: {
          requestId: "req-1",
          ok: true,
          result: { command: "future_command" },
        },
      } as unknown as BrowserAutomationExecuteResponse),
    ).toBe(true);

    await expect(resultPromise).resolves.toMatchObject({
      requestId: "req-1",
      ok: false,
      error: {
        code: "browser_unknown_error",
        retryable: false,
      },
    });
    expect(broker.getPendingRequestCount()).toBe(0);
  });
});

class FakeLiveHost extends FakeBrowserHostClient {
  public readonly liveMessages: BrowserHostLiveOutboundMessage[] = [];
  public readonly liveView: NonNullable<BrowserHostClient["liveView"]> = {
    send: (message: BrowserHostLiveOutboundMessage) => {
      this.liveMessages.push(message);
    },
  };

  public lastLiveRequest(
    type: Extract<BrowserHostLiveOutboundMessage, { requestId: string }>["type"],
  ): Extract<BrowserHostLiveOutboundMessage, { requestId: string }> {
    const message = this.liveMessages.findLast((candidate) => candidate.type === type);
    if (!message || !("requestId" in message)) throw new Error(`No ${type} sent`);
    return message;
  }

  public acks(): number[] {
    return this.liveMessages.flatMap((message) =>
      message.type === "browser.host.live.frame_ack" ? [message.frameSeq] : [],
    );
  }
}

interface RecordingViewer {
  frames: Uint8Array[];
  ended: Array<{ code: string }>;
  endedControl: Array<{ held: boolean } | undefined>;
  results: BrowserLiveViewStartResult[];
  sink: BrowserLiveViewSink;
  respond: (result: BrowserLiveViewStartResult) => void;
}

function createViewer(): RecordingViewer {
  const viewer: RecordingViewer = {
    frames: [],
    ended: [],
    endedControl: [],
    results: [],
    sink: {
      sendFrame: (frame) => viewer.frames.push(frame),
      ended: (error, control) => {
        viewer.ended.push(error);
        viewer.endedControl.push(control);
      },
    },
    respond: (result) => viewer.results.push(result),
  };
  return viewer;
}

function createLiveBroker(options: { enabled?: () => boolean } = {}): BrowserToolsBroker {
  let sequence = 0;
  return new BrowserToolsBroker({
    defaultTimeoutMs: 100,
    createRequestId: () => `req-${++sequence}`,
    isLiveViewEnabled: options.enabled ?? (() => true),
  });
}

function liveFrame(streamId: string, frameSeq: number): Uint8Array {
  return encodeBrowserLiveFrame({
    streamId,
    frameSeq,
    metadata: {
      deviceWidth: 800,
      deviceHeight: 600,
      offsetTop: 0,
      pageScaleFactor: 1,
      scrollOffsetX: 0,
      scrollOffsetY: 0,
    },
    jpeg: new Uint8Array([0xff, 0xd8, frameSeq, 0xff, 0xd9]),
  });
}

function relay(broker: BrowserToolsBroker, host: FakeLiveHost, bytes: Uint8Array): boolean {
  const header = decodeBrowserLiveFrameHeader(bytes);
  if (!header) throw new Error("invalid frame");
  return broker.receiveLiveFrame({ header, bytes, clientIds: [host.id] });
}

async function startStream(params: {
  broker: BrowserToolsBroker;
  host: FakeLiveHost;
  viewer: RecordingViewer;
  streamId?: string;
  viewerId?: string;
  ownerId?: string;
  browserId?: string;
}): Promise<void> {
  const started = params.broker.startLiveView({
    streamId: params.streamId ?? "stream-1",
    browserId: params.browserId ?? BROWSER_ID,
    viewerId: params.viewerId ?? "viewer-1",
    ownerId: params.ownerId ?? "phone",
    options: { maxFps: 5 },
    sink: params.viewer.sink,
    respond: params.viewer.respond,
  });
  const request = params.host.lastLiveRequest("browser.host.live.start.request");
  params.broker.receiveLiveResponse({
    payload: { requestId: request.requestId, viewport: { width: 800, height: 600 }, error: null },
    clientIds: [params.host.id],
  });
  await started;
}

describe("BrowserToolsBroker live view", () => {
  test("refuses to start while the host setting is off, without contacting the host", async () => {
    const broker = createLiveBroker({ enabled: () => false });
    const host = new FakeLiveHost("host-1");
    broker.registerClient(host);
    const viewer = createViewer();

    await broker.startLiveView({
      streamId: "stream-1",
      browserId: BROWSER_ID,
      viewerId: "viewer-1",
      ownerId: "owner-viewer-1",
      options: {},
      sink: viewer.sink,
      respond: viewer.respond,
    });

    expect(viewer.results).toEqual([
      {
        ok: false,
        error: {
          code: "browser_unsupported",
          message: "Browser live view is turned off in Host settings.",
          retryable: false,
        },
        control: { held: false },
      },
    ]);
    expect(host.liveMessages).toEqual([]);
  });

  test("switching the setting off stops every stream on the host and tells viewers", async () => {
    let enabled = true;
    const broker = createLiveBroker({ enabled: () => enabled });
    const host = new FakeLiveHost("host-1");
    broker.registerClient(host);
    const first = createViewer();
    const second = createViewer();
    await startStream({ broker, host, viewer: first });
    await startStream({
      broker,
      host,
      viewer: second,
      streamId: "stream-2",
      viewerId: "viewer-2",
      browserId: SECOND_BROWSER_ID,
    });

    enabled = false;
    broker.stopAllLiveViews();

    expect(first.ended).toEqual([expect.objectContaining({ code: "browser_unsupported" })]);
    expect(second.ended).toEqual([expect.objectContaining({ code: "browser_unsupported" })]);
    expect(
      host.liveMessages
        .filter((message) => message.type === "browser.host.live.stop.request")
        .map((message) => ("streamId" in message ? message.streamId : null)),
    ).toEqual(["stream-1", "stream-2"]);
    expect(broker.getLiveViewCount()).toBe(0);
  });

  test("routes start to the host that owns the tab and relays its frames to the viewer", async () => {
    const broker = createLiveBroker();
    const owner = new FakeLiveHost("host-owner");
    const other = new FakeLiveHost("host-other");
    broker.registerClient(owner);
    const execution = broker.execute({
      command: { command: "new_tab", args: {} },
      workspaceId: "workspace-1",
    });
    owner.resolveLatestWith(broker, {
      requestId: "ignored",
      ok: true,
      result: {
        command: "new_tab",
        browserId: BROWSER_ID,
        workspaceId: "workspace-1",
        url: "https://example.com",
      },
    });
    await execution;
    broker.registerClient(other);

    const viewer = createViewer();
    await startStream({ broker, host: owner, viewer });

    expect(other.liveMessages).toEqual([]);
    expect(owner.lastLiveRequest("browser.host.live.start.request")).toMatchObject({
      streamId: "stream-1",
      browserId: BROWSER_ID,
      maxFps: 5,
    });
    expect(viewer.results).toEqual([
      { ok: true, streamId: "stream-1", viewport: { width: 800, height: 600 } },
    ]);

    const frame = liveFrame("stream-1", 0);
    expect(
      broker.receiveLiveFrame({
        header: { streamId: "stream-1", frameSeq: 0 },
        bytes: frame,
        clientIds: [other.id],
      }),
    ).toBe(false);
    expect(relay(broker, owner, frame)).toBe(true);
    expect(viewer.frames).toEqual([frame]);
    expect(viewer.frames[0]).toBe(frame);
  });

  test("hosts registered without liveView answer browser_unsupported", async () => {
    const broker = createLiveBroker();
    broker.registerClient(new FakeBrowserHostClient("host-old"));
    const viewer = createViewer();

    await broker.startLiveView({
      streamId: "stream-1",
      browserId: BROWSER_ID,
      viewerId: "viewer-1",
      ownerId: "owner-viewer-1",
      options: {},
      sink: viewer.sink,
      respond: viewer.respond,
    });

    expect(viewer.results).toEqual([
      {
        ok: false,
        error: expect.objectContaining({ code: "browser_unsupported" }),
        control: { held: false },
      },
    ]);
    expect(broker.getLiveViewCount()).toBe(0);
  });

  test("allows one stream per tab until it stops", async () => {
    const broker = createLiveBroker();
    const host = new FakeLiveHost("host-1");
    broker.registerClient(host);
    await startStream({ broker, host, viewer: createViewer() });

    const second = createViewer();
    await broker.startLiveView({
      streamId: "stream-2",
      browserId: BROWSER_ID,
      viewerId: "viewer-2",
      ownerId: "owner-viewer-2",
      options: {},
      sink: second.sink,
      respond: second.respond,
    });
    expect(second.results).toEqual([
      {
        ok: false,
        error: expect.objectContaining({ code: "browser_denied" }),
        control: { held: false },
      },
    ]);
    expect(
      host.liveMessages.filter((m) => m.type === "browser.host.live.start.request"),
    ).toHaveLength(1);

    await expect(
      broker.stopLiveView({ streamId: "stream-1", viewerId: "viewer-2" }),
    ).resolves.toMatchObject({
      error: { code: "browser_tab_not_found" },
    });
    const stopping = broker.stopLiveView({ streamId: "stream-1", viewerId: "viewer-1" });
    broker.receiveLiveResponse({
      payload: {
        requestId: host.lastLiveRequest("browser.host.live.stop.request").requestId,
        error: null,
      },
      clientIds: [host.id],
    });
    await expect(stopping).resolves.toEqual({ error: null });

    await startStream({ broker, host, viewer: second, streamId: "stream-2", viewerId: "viewer-2" });
    expect(second.results.at(-1)).toMatchObject({ ok: true, streamId: "stream-2" });
  });

  test("forwards only the viewer's ack for the frame in flight", async () => {
    const broker = createLiveBroker();
    const host = new FakeLiveHost("host-1");
    broker.registerClient(host);
    await startStream({ broker, host, viewer: createViewer() });

    relay(broker, host, liveFrame("stream-1", 0));
    expect(broker.ackLiveFrame({ streamId: "stream-1", frameSeq: 0, viewerId: "viewer-2" })).toBe(
      false,
    );
    expect(broker.ackLiveFrame({ streamId: "stream-1", frameSeq: 1, viewerId: "viewer-1" })).toBe(
      false,
    );
    expect(host.acks()).toEqual([]);

    expect(broker.ackLiveFrame({ streamId: "stream-1", frameSeq: 0, viewerId: "viewer-1" })).toBe(
      true,
    );
    expect(broker.ackLiveFrame({ streamId: "stream-1", frameSeq: 0, viewerId: "viewer-1" })).toBe(
      false,
    );
    expect(host.acks()).toEqual([0]);

    relay(broker, host, liveFrame("stream-1", 1));
    expect(broker.ackLiveFrame({ streamId: "stream-1", frameSeq: 1, viewerId: "viewer-1" })).toBe(
      true,
    );
    expect(host.acks()).toEqual([0, 1]);
  });

  test("delivers a frame that beats the start response only after the viewer's response", async () => {
    const broker = createLiveBroker();
    const host = new FakeLiveHost("host-1");
    broker.registerClient(host);
    const order: string[] = [];
    const started = broker.startLiveView({
      streamId: "stream-1",
      browserId: BROWSER_ID,
      viewerId: "viewer-1",
      ownerId: "owner-viewer-1",
      options: {},
      sink: { sendFrame: () => order.push("frame"), ended: () => order.push("ended") },
      respond: () => order.push("response"),
    });
    relay(broker, host, liveFrame("stream-1", 0));
    broker.receiveLiveResponse({
      payload: {
        requestId: host.lastLiveRequest("browser.host.live.start.request").requestId,
        viewport: { width: 1, height: 1 },
        error: null,
      },
      clientIds: [host.id],
    });
    await started;
    expect(order).toEqual(["response", "frame"]);
  });

  test("a host error fails the start and frees the tab", async () => {
    const broker = createLiveBroker();
    const host = new FakeLiveHost("host-1");
    broker.registerClient(host);
    const viewer = createViewer();
    const started = broker.startLiveView({
      streamId: "stream-1",
      browserId: BROWSER_ID,
      viewerId: "viewer-1",
      ownerId: "owner-viewer-1",
      options: {},
      sink: viewer.sink,
      respond: viewer.respond,
    });
    broker.receiveLiveResponse({
      payload: {
        requestId: host.lastLiveRequest("browser.host.live.start.request").requestId,
        viewport: null,
        error: { code: "browser_tab_not_found", message: "gone", retryable: false },
      },
      clientIds: [host.id],
    });
    await started;
    expect(viewer.results).toEqual([
      {
        ok: false,
        error: { code: "browser_tab_not_found", message: "gone", retryable: false },
        control: { held: false },
      },
    ]);
    expect(broker.getLiveViewCount()).toBe(0);
  });

  test("viewer leaving during start stops the host stream once it starts", async () => {
    const broker = createLiveBroker();
    const host = new FakeLiveHost("host-1");
    broker.registerClient(host);
    const viewer = createViewer();
    const started = broker.startLiveView({
      streamId: "stream-1",
      browserId: BROWSER_ID,
      viewerId: "viewer-1",
      ownerId: "owner-viewer-1",
      options: {},
      sink: viewer.sink,
      respond: viewer.respond,
    });
    const startRequest = host.lastLiveRequest("browser.host.live.start.request");
    void broker.stopLiveView({ streamId: "stream-1", viewerId: "viewer-1" });
    broker.receiveLiveResponse({
      payload: {
        requestId: startRequest.requestId,
        viewport: { width: 1, height: 1 },
        error: null,
      },
      clientIds: [host.id],
    });
    await started;

    expect(viewer.results).toEqual([
      { ok: false, error: expect.anything(), control: { held: false } },
    ]);
    expect(
      host.liveMessages.filter((m) => m.type === "browser.host.live.stop.request"),
    ).toHaveLength(2);
    expect(broker.getLiveViewCount()).toBe(0);
  });

  test("an unanswered start asks the host to stop the screencast it may have started", async () => {
    vi.useFakeTimers();
    const broker = createLiveBroker();
    const host = new FakeLiveHost("host-1");
    broker.registerClient(host);
    const viewer = createViewer();
    const started = broker.startLiveView({
      streamId: "stream-1",
      browserId: BROWSER_ID,
      viewerId: "viewer-1",
      ownerId: "owner-viewer-1",
      options: {},
      sink: viewer.sink,
      respond: viewer.respond,
    });
    await vi.advanceTimersByTimeAsync(100);
    await started;

    expect(viewer.results).toEqual([
      {
        ok: false,
        error: expect.objectContaining({ code: "browser_timeout" }),
        control: { held: false },
      },
    ]);
    expect(host.lastLiveRequest("browser.host.live.stop.request")).toMatchObject({
      streamId: "stream-1",
    });
    vi.useRealTimers();
  });

  test("the host ending its screencast frees the tab and tells the viewer", async () => {
    const broker = createLiveBroker();
    const host = new FakeLiveHost("host-1");
    const other = new FakeLiveHost("host-2");
    broker.registerClient(host);
    const viewer = createViewer();
    await startStream({ broker, host, viewer });
    broker.registerClient(other);

    const ended = {
      streamId: "stream-1",
      error: { code: "browser_tab_closed" as const, message: "Tab closed.", retryable: false },
    };
    expect(broker.receiveLiveEnded({ payload: ended, clientIds: [other.id] })).toBe(false);
    expect(broker.receiveLiveEnded({ payload: ended, clientIds: [host.id] })).toBe(true);

    expect(viewer.ended).toEqual([ended.error]);
    expect(broker.getLiveViewCount()).toBe(0);
    broker.unregisterClient(other.id);
    await startStream({ broker, host, viewer: createViewer(), streamId: "stream-2" });
    expect(broker.getLiveViewCount()).toBe(1);
  });

  test("host disconnect ends its streams and tells the viewer", async () => {
    const broker = createLiveBroker();
    const host = new FakeLiveHost("host-1");
    broker.registerClient(host);
    const viewer = createViewer();
    await startStream({ broker, host, viewer });

    broker.unregisterClient(host.id);

    expect(viewer.ended).toEqual([expect.objectContaining({ code: "browser_no_host" })]);
    expect(broker.getLiveViewCount()).toBe(0);
    expect(relay(broker, host, liveFrame("stream-1", 0))).toBe(false);
  });

  test("closing the tab through browser tools ends its stream", async () => {
    const broker = createLiveBroker();
    const host = new FakeLiveHost("host-1");
    broker.registerClient(host);
    const viewer = createViewer();
    await startStream({ broker, host, viewer });

    const closing = broker.execute({
      command: { command: "close_tab", args: { browserId: BROWSER_ID } },
    });
    host.resolveLatestWith(broker, {
      requestId: "ignored",
      ok: true,
      result: { command: "close_tab", browserId: BROWSER_ID },
    });
    await closing;

    expect(viewer.ended).toEqual([expect.objectContaining({ code: "browser_tab_closed" })]);
    expect(broker.getLiveViewCount()).toBe(0);
  });

  test("an unanswered start times out and frees the tab", async () => {
    vi.useFakeTimers();
    const broker = createLiveBroker();
    broker.registerClient(new FakeLiveHost("host-1"));
    const viewer = createViewer();
    const started = broker.startLiveView({
      streamId: "stream-1",
      browserId: BROWSER_ID,
      viewerId: "viewer-1",
      ownerId: "owner-viewer-1",
      options: {},
      sink: viewer.sink,
      respond: viewer.respond,
    });
    await vi.advanceTimersByTimeAsync(100);
    await started;
    expect(viewer.results).toEqual([
      {
        ok: false,
        error: expect.objectContaining({ code: "browser_timeout" }),
        control: { held: false },
      },
    ]);
    expect(broker.getLiveViewCount()).toBe(0);
    vi.useRealTimers();
  });
});

describe("BrowserToolsBroker human control", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const GRACE_MS = 5 * 60_000;
  const FOCUS = {
    targetId: "target-1",
    kind: "password",
    origin: "https://idp.example",
    topOrigin: "https://app.example",
  };
  const SENTINEL = "LV3-SENTINEL-broker";

  class FakeControlHost extends FakeLiveHost {
    public override readonly liveView: NonNullable<BrowserHostClient["liveView"]> = {
      input: true,
      send: (message) => {
        this.liveMessages.push(message);
      },
    };
  }

  function controlledBroker(options: { enabled?: () => boolean } = {}) {
    let sequence = 0;
    const endings: Array<{ agentIds: string[]; note: string }> = [];
    const broker = new BrowserToolsBroker({
      defaultTimeoutMs: 100,
      createRequestId: () => `req-${++sequence}`,
      isLiveViewEnabled: options.enabled ?? (() => true),
      onHumanControlEnded: (ending) => endings.push(ending),
    });
    const host = new FakeControlHost("host-1");
    broker.registerClient(host);

    const answer = (
      payload: Record<string, unknown>,
      type: Parameters<FakeLiveHost["lastLiveRequest"]>[0],
    ) =>
      broker.receiveLiveResponse({
        payload: { requestId: host.lastLiveRequest(type).requestId, ...payload } as never,
        clientIds: [host.id],
      });
    const viewer = (streamId = "stream-1", viewerId = "viewer-1", ownerId = "phone") => ({
      streamId,
      viewerId,
      ownerId,
    });
    const watch = async (as = viewer()) => {
      const recording = createViewer();
      await startStream({ broker, host, viewer: recording, ...as });
      return recording;
    };
    const take = async (as = viewer()) => {
      const taking = broker.takeControl(as);
      answer({ focus: FOCUS, error: null }, "browser.host.live.take_control.request");
      return taking;
    };
    const released = async (error: { code: string; message: string } | null = null) => {
      answer({ error }, "browser.host.live.release_control.request");
      await vi.advanceTimersByTimeAsync(0);
    };
    const leave = async (as = viewer()) => {
      const stopping = broker.stopLiveView(as);
      answer({ error: null }, "browser.host.live.stop.request");
      await stopping;
    };
    const releases = () =>
      host.liveMessages.filter(
        (message) => message.type === "browser.host.live.release_control.request",
      );
    const agentSnapshot = async (agentId = "agent-1") => {
      const before = host.receivedRequests.length;
      const result = broker.execute({ agentId, command: snapshotCommand() });
      await Promise.resolve();
      if (host.receivedRequests.length > before) {
        host.resolveLatestWith(broker, {
          requestId: "ignored",
          ok: true,
          result: {
            command: "snapshot",
            browserId: BROWSER_ID,
            url: "https://app.example",
            title: "App",
            format: "aria-yaml",
            snapshot: "",
            refs: [],
            truncated: false,
            stats: { nodeCount: 0, refCount: 0, textLength: 0 },
          } as never,
        });
      }
      return result;
    };
    return {
      broker,
      host,
      endings,
      answer,
      viewer,
      watch,
      take,
      released,
      leave,
      releases,
      agentSnapshot,
    };
  }

  test("watching never locks the agent out", async () => {
    const { watch, agentSnapshot } = controlledBroker();
    const recording = await watch();
    expect(recording.results).toEqual([expect.objectContaining({ control: { held: false } })]);
    await expect(agentSnapshot()).resolves.toMatchObject({ ok: true });
  });

  test("a desktop without input support can be watched but not controlled", async () => {
    const broker = createLiveBroker();
    const host = new FakeLiveHost("host-old");
    broker.registerClient(host);
    const recording = createViewer();
    await startStream({ broker, host, viewer: recording });

    expect(recording.results[0]).not.toHaveProperty("control");
    await expect(
      broker.takeControl({ streamId: "stream-1", viewerId: "viewer-1", ownerId: "phone" }),
    ).resolves.toMatchObject({ error: { code: "update_desktop" } });
    expect(host.liveMessages.map((message) => message.type)).toEqual([
      "browser.host.live.start.request",
    ]);
  });

  test("locks as soon as take control is asked for, before the desktop answers", async () => {
    const { broker, host, answer, viewer, watch } = controlledBroker();
    await watch();
    const taking = broker.takeControl(viewer());

    await expect(
      broker.execute({ agentId: "agent-1", command: snapshotCommand() }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "browser_human_control" },
    });
    await expect(
      broker.sendLiveInput({ ...viewer(), input: { kind: "key", key: "Tab" } }),
    ).resolves.toMatchObject({ error: { code: "not_controller" } });

    answer({ focus: FOCUS, error: null }, "browser.host.live.take_control.request");
    await expect(taking).resolves.toEqual({ focus: FOCUS, error: null });
    expect(host.receivedRequests).toEqual([]);
  });

  test("a failed take releases the tab again", async () => {
    const { broker, answer, viewer, watch, agentSnapshot, releases } = controlledBroker();
    await watch();
    const taking = broker.takeControl(viewer());
    answer(
      { focus: null, error: { code: "agent_busy", message: "Busy." } },
      "browser.host.live.take_control.request",
    );
    await expect(taking).resolves.toMatchObject({ error: { code: "agent_busy" } });
    expect(releases()).toEqual([expect.objectContaining({ discardInput: false })]);
    await expect(agentSnapshot()).resolves.toMatchObject({ ok: true });
  });

  test("refuses every command that targets the held tab, reads included", async () => {
    const { broker, host, watch, take } = controlledBroker();
    await watch();
    await take();
    const browserId = BROWSER_ID;
    const ref = "@e1";
    const commands = [
      { command: "snapshot", args: { browserId } },
      {
        command: "click",
        args: { browserId, ref, button: "left", doubleClick: false, modifiers: [] },
      },
      { command: "fill", args: { browserId, ref, value: "x" } },
      { command: "wait", args: { browserId, text: "x" } },
      { command: "type", args: { browserId, text: "x" } },
      { command: "keypress", args: { browserId, key: "Enter" } },
      { command: "navigate", args: { browserId, url: "https://example.com" } },
      { command: "back", args: { browserId } },
      { command: "forward", args: { browserId } },
      { command: "reload", args: { browserId } },
      { command: "screenshot", args: { browserId, fullPage: false } },
      { command: "upload", args: { browserId, ref, filePaths: ["file.txt"] } },
      { command: "select", args: { browserId, ref, value: "x" } },
      { command: "hover", args: { browserId, ref } },
      { command: "drag", args: { browserId, sourceRef: ref, targetRef: "@e2" } },
      { command: "logs", args: { browserId, maxEntries: 10 } },
      { command: "evaluate", args: { browserId, function: "() => 1" } },
      { command: "scroll", args: { browserId, deltaX: 0, deltaY: 1 } },
      { command: "resize", args: { browserId, width: 800, height: 600 } },
      { command: "close_tab", args: { browserId } },
    ] as BrowserAutomationCommand[];
    expect(new Set(commands.map((command) => command.command))).toEqual(
      new Set(
        BROWSER_AUTOMATION_COMMAND_NAMES.filter(
          (name) => name !== "list_tabs" && name !== "new_tab",
        ),
      ),
    );

    for (const command of commands) {
      await expect(broker.execute({ agentId: "agent-1", command })).resolves.toMatchObject({
        ok: false,
        error: {
          code: "browser_human_control",
          retryable: true,
          message: expect.stringContaining("browser_snapshot"),
        },
      });
    }
    expect(host.receivedRequests).toEqual([]);
  });

  test("other tabs stay available to agents", async () => {
    const { broker, host, watch, take } = controlledBroker();
    await watch();
    await take();
    void broker.execute({ command: { command: "reload", args: { browserId: SECOND_BROWSER_ID } } });
    await Promise.resolve();
    expect(host.receivedRequests).toHaveLength(1);
  });

  test("list_tabs withholds the held tab's address and title", async () => {
    const { broker, host, watch, take } = controlledBroker();
    await watch();
    await take();
    const listing = broker.execute({ command: { command: "list_tabs", args: {} } });
    await Promise.resolve();
    const tab = { isActive: false, isLoading: false };
    host.resolveLatestWith(broker, {
      requestId: "ignored",
      ok: true,
      result: {
        command: "list_tabs",
        tabs: [
          { ...tab, browserId: BROWSER_ID, url: "https://app.example/?code=1", title: "Secret" },
          { ...tab, browserId: SECOND_BROWSER_ID, url: "https://docs.example/", title: "Docs" },
        ],
      },
    });
    await expect(listing).resolves.toMatchObject({
      result: {
        tabs: [
          { browserId: BROWSER_ID, url: "", title: "", humanControl: true },
          { browserId: SECOND_BROWSER_ID, url: "https://docs.example/", title: "Docs" },
        ],
      },
    });
  });

  test("reports the desktop's own refusal as human control", async () => {
    const { broker, host, answer, viewer, watch } = controlledBroker();
    await watch();
    const racing = broker.execute({ agentId: "agent-1", command: snapshotCommand() });
    await Promise.resolve();
    const taking = broker.takeControl(viewer());
    host.resolveLatestWith(broker, {
      requestId: "ignored",
      ok: false,
      error: { code: "browser_denied", message: "Held.", retryable: true },
    });
    await expect(racing).resolves.toMatchObject({ error: { code: "browser_human_control" } });
    answer({ focus: null, error: null }, "browser.host.live.take_control.request");
    await taking;
  });

  test("forwards the controller's input and refuses everyone else's", async () => {
    const { broker, host, answer, viewer, watch, take } = controlledBroker();
    await watch();
    await take();
    const input = { kind: "insert_text", targetId: "target-1", text: SENTINEL } as const;

    for (const impostor of [
      viewer("stream-1", "viewer-2"),
      viewer("stream-1", "viewer-1", "tablet"),
    ]) {
      await expect(broker.sendLiveInput({ ...impostor, input })).resolves.toMatchObject({
        error: { code: "stream_ended" },
      });
    }
    expect(JSON.stringify(host.liveMessages)).not.toContain(SENTINEL);

    const sending = broker.sendLiveInput({ ...viewer(), input });
    expect(host.lastLiveRequest("browser.host.live.send_input.request")).toMatchObject({
      streamId: "stream-1",
      input,
    });
    answer({ focus: null, error: null }, "browser.host.live.send_input.request");
    await expect(sending).resolves.toEqual({ focus: null, error: null });
  });

  test("an unanswered insert keeps the lock and isn't sent again", async () => {
    vi.useFakeTimers();
    const { broker, host, viewer, watch, take, agentSnapshot } = controlledBroker();
    await watch();
    await take();
    const sending = broker.sendLiveInput({
      ...viewer(),
      input: { kind: "insert_text", targetId: "target-1", text: SENTINEL },
    });
    await vi.advanceTimersByTimeAsync(30_000);

    const result = await sending;
    expect(result).toMatchObject({ error: { code: "unconfirmed" } });
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
    expect(
      host.liveMessages.filter(
        (message) => message.type === "browser.host.live.send_input.request",
      ),
    ).toHaveLength(1);
    await expect(agentSnapshot()).resolves.toMatchObject({
      error: { code: "browser_human_control" },
    });
  });

  test("only the controller can watch a held tab again", async () => {
    vi.useFakeTimers();
    const { broker, viewer, watch, take, leave, host } = controlledBroker();
    await watch();
    await take();
    await leave();

    const stranger = createViewer();
    await broker.startLiveView({
      ...viewer("stream-2", "viewer-2", "tablet"),
      browserId: BROWSER_ID,
      options: {},
      sink: stranger.sink,
      respond: stranger.respond,
    });
    expect(stranger.results).toEqual([
      {
        ok: false,
        error: expect.objectContaining({ code: "browser_denied" }),
        control: { held: false },
      },
    ]);

    // A new session of the same phone.
    const returned = await watch(viewer("stream-3", "viewer-3"));
    expect(returned.results).toEqual([expect.objectContaining({ control: { held: true } })]);
    expect(host.lastLiveRequest("browser.host.live.start.request")).toMatchObject({
      controlId: expect.any(String),
    });
  });

  test("returning inside five minutes resumes control", async () => {
    vi.useFakeTimers();
    const { broker, answer, viewer, watch, take, leave, releases } = controlledBroker();
    await watch();
    await take();
    await leave();
    await vi.advanceTimersByTimeAsync(GRACE_MS - 1000);
    await watch(viewer("stream-2"));
    await vi.advanceTimersByTimeAsync(GRACE_MS * 2);

    expect(releases()).toEqual([]);
    const sending = broker.sendLiveInput({
      ...viewer("stream-2"),
      input: { kind: "key", key: "Tab" },
    });
    answer({ focus: null, error: null }, "browser.host.live.send_input.request");
    await expect(sending).resolves.toMatchObject({ error: null });
  });

  test("releases five minutes after the phone left, discarding what it typed", async () => {
    vi.useFakeTimers();
    const { watch, take, leave, releases, released, agentSnapshot, endings } = controlledBroker();
    await watch();
    await take();
    await agentSnapshot();
    await leave();
    await vi.advanceTimersByTimeAsync(GRACE_MS - 1);
    expect(releases()).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(releases()).toEqual([expect.objectContaining({ discardInput: true })]);
    // Still locked until the desktop discarded it.
    await expect(agentSnapshot()).resolves.toMatchObject({
      error: { code: "browser_human_control" },
    });

    await released();
    expect(endings).toEqual([
      { agentIds: ["agent-1"], note: expect.stringContaining("discarded") },
    ]);
    await expect(agentSnapshot()).resolves.toMatchObject({ ok: true });
  });

  test("retries an auto-release the desktop couldn't finish, still locked", async () => {
    vi.useFakeTimers();
    const { watch, take, leave, releases, released, agentSnapshot } = controlledBroker();
    await watch();
    await take();
    await leave();
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    await released({ code: "failed", message: "No." });
    await expect(agentSnapshot()).resolves.toMatchObject({
      error: { code: "browser_human_control" },
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(releases()).toHaveLength(2);
    await released();
    await expect(agentSnapshot()).resolves.toMatchObject({ ok: true });
  });

  test("hand-back discards nothing and leaves the agent one note, without secrets", async () => {
    const { broker, answer, viewer, watch, take, releases, endings, agentSnapshot } =
      controlledBroker();
    await watch();
    await agentSnapshot();
    await take();

    const handingBack = broker.releaseControl(viewer());
    answer({ error: null }, "browser.host.live.release_control.request");
    await expect(handingBack).resolves.toEqual({ error: null });

    expect(releases()).toEqual([expect.objectContaining({ discardInput: false })]);
    const note = expect.stringContaining("handed browser tab");
    expect(endings).toEqual([{ agentIds: ["agent-1"], note }]);
    await expect(agentSnapshot()).resolves.toMatchObject({ ok: true, userNotes: [note] });
    expect(await agentSnapshot()).not.toHaveProperty("userNotes");
  });

  test("the note finds the next caller when the daemon saw no agent use the tab", async () => {
    const { broker, answer, viewer, watch, take, agentSnapshot } = controlledBroker();
    await watch();
    await take();
    const handingBack = broker.releaseControl(viewer());
    answer({ error: null }, "browser.host.live.release_control.request");
    await handingBack;
    await expect(agentSnapshot("agent-2")).resolves.toMatchObject({
      userNotes: [expect.stringContaining(BROWSER_ID)],
    });
  });

  test("a hand-back the desktop couldn't finish keeps control", async () => {
    const { broker, answer, viewer, watch, take, agentSnapshot } = controlledBroker();
    await watch();
    await take();
    const handingBack = broker.releaseControl(viewer());
    answer(
      { error: { code: "failed", message: "No." } },
      "browser.host.live.release_control.request",
    );
    await expect(handingBack).resolves.toMatchObject({ error: { code: "failed" } });
    await expect(agentSnapshot()).resolves.toMatchObject({
      error: { code: "browser_human_control" },
    });
  });

  test("switching the setting off discards and releases, locked until done", async () => {
    vi.useFakeTimers();
    let enabled = true;
    const { broker, answer, watch, take, releases, released, agentSnapshot } = controlledBroker({
      enabled: () => enabled,
    });
    await watch();
    await take();
    enabled = false;
    broker.stopAllLiveViews();
    answer({ error: null }, "browser.host.live.stop.request");

    expect(releases()).toEqual([expect.objectContaining({ discardInput: true })]);
    await expect(agentSnapshot()).resolves.toMatchObject({
      error: { code: "browser_human_control" },
    });
    await released();
    await expect(agentSnapshot()).resolves.toMatchObject({ ok: true });
  });

  test("a desktop disconnect ends control here; that desktop discards and unlocks itself", async () => {
    const { broker, host, watch, take, endings, releases, agentSnapshot } = controlledBroker();
    await watch();
    await take();
    await agentSnapshot();
    broker.unregisterClient(host.id);

    expect(releases()).toEqual([]);
    expect(endings).toEqual([{ agentIds: ["agent-1"], note: expect.any(String) }]);
    await expect(agentSnapshot()).resolves.toMatchObject({ error: { code: "browser_no_host" } });
  });

  test("closing the tab ends control, and only its host can say so", async () => {
    const { broker, host, watch, take, agentSnapshot } = controlledBroker();
    await watch();
    await take();
    const taken = host.lastLiveRequest("browser.host.live.take_control.request") as Extract<
      BrowserHostLiveOutboundMessage,
      { controlId: string }
    >;
    const payload = { controlId: taken.controlId };

    expect(broker.receiveControlEnded({ payload, clientIds: ["another-host"] })).toBe(false);
    await expect(agentSnapshot()).resolves.toMatchObject({
      error: { code: "browser_human_control" },
    });
    expect(broker.receiveControlEnded({ payload, clientIds: [host.id] })).toBe(true);
    await expect(agentSnapshot()).resolves.toMatchObject({ ok: true });
  });

  test("a failed take leaves the last hand-back note waiting", async () => {
    vi.useFakeTimers();
    const { broker, answer, viewer, watch, take, released, agentSnapshot } = controlledBroker();
    await agentSnapshot();
    await watch();
    await take();
    const handingBack = broker.releaseControl(viewer());
    await released();
    await handingBack;

    const taking = broker.takeControl(viewer());
    const refused = await broker.execute({ agentId: "agent-1", command: snapshotCommand() });
    expect(refused).not.toHaveProperty("userNotes");
    answer(
      { focus: null, error: { code: "agent_busy", message: "Busy." } },
      "browser.host.live.take_control.request",
    );
    await taking;

    await expect(agentSnapshot()).resolves.toMatchObject({
      userNotes: [expect.stringContaining("handed browser tab")],
    });
  });

  test("a granted take drops the note it made stale", async () => {
    vi.useFakeTimers();
    const { broker, viewer, watch, take, released, releases, agentSnapshot } = controlledBroker();
    await agentSnapshot();
    await watch();
    await take();
    const handingBack = broker.releaseControl(viewer());
    await released();
    await handingBack;

    await take();
    await expect(agentSnapshot()).resolves.not.toHaveProperty("userNotes");
    expect(releases()).toHaveLength(1);
  });

  test("a stream that ends while control goes on says so", async () => {
    const { broker, host, watch, take } = controlledBroker();
    const recording = await watch();
    await take();
    const error = { code: "browser_tab_closed", message: "Detached.", retryable: false } as const;
    broker.receiveLiveEnded({ payload: { streamId: "stream-1", error }, clientIds: [host.id] });
    expect(recording.endedControl).toEqual([{ held: true }]);
  });

  test("a stream that ends with control says so", async () => {
    const { broker, host, watch, take } = controlledBroker();
    const recording = await watch();
    await take();
    broker.unregisterClient(host.id);
    expect(recording.endedControl).toEqual([{ held: false }]);
  });

  test("switching the setting off tells the viewer control is over", async () => {
    const { broker, watch, take } = controlledBroker();
    const recording = await watch();
    await take();
    broker.stopAllLiveViews();
    expect(recording.endedControl).toEqual([{ held: false }]);
  });

  test("a start that fails says whether the viewer still holds the tab", async () => {
    const { broker, host, viewer, watch, take } = controlledBroker();
    await watch();
    await take();
    const again = createViewer();
    await broker.startLiveView({
      ...viewer("stream-2"),
      browserId: BROWSER_ID,
      options: {},
      sink: again.sink,
      respond: again.respond,
    });
    expect(again.results).toEqual([
      expect.objectContaining({ ok: false, control: { held: true } }),
    ]);
    expect(host.receivedRequests).toEqual([]);
  });

  test("an inactive stream is not a lost control", async () => {
    vi.useFakeTimers();
    const { broker, viewer, watch, take, leave } = controlledBroker();
    await watch();
    await take();
    await leave();
    const gone = { error: { code: "stream_ended" } };
    const input = { kind: "key", key: "Tab" } as const;
    await expect(broker.sendLiveInput({ ...viewer(), input })).resolves.toMatchObject(gone);
    await expect(broker.releaseControl(viewer())).resolves.toMatchObject(gone);
    await expect(broker.takeControl(viewer())).resolves.toMatchObject(gone);
  });

  test("the desktop can't declare control lost while the daemon holds the lock", async () => {
    const { broker, answer, viewer, watch, take } = controlledBroker();
    await watch();
    await take();
    const error = { code: "not_controller", message: "Unknown control." };
    const input = { kind: "key", key: "Tab" } as const;
    const sending = broker.sendLiveInput({ ...viewer(), input });
    answer({ focus: null, error }, "browser.host.live.send_input.request");
    await expect(sending).resolves.toMatchObject({ error: { code: "failed" } });

    const handingBack = broker.releaseControl(viewer());
    answer({ error }, "browser.host.live.release_control.request");
    await expect(handingBack).resolves.toMatchObject({ error: { code: "failed" } });
  });

  test("a restarted daemon holds no lock", async () => {
    const before = controlledBroker();
    await before.watch();
    await before.take();

    // The desktop discards and unlocks itself when it loses the old daemon.
    const after = controlledBroker();
    await expect(after.agentSnapshot()).resolves.toMatchObject({ ok: true });
  });
});
