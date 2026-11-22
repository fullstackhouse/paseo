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
  public readonly liveView = {
    send: (message: BrowserHostLiveOutboundMessage) => {
      this.liveMessages.push(message);
    },
  };

  public lastLiveRequest(
    type: "browser.host.live.start.request" | "browser.host.live.stop.request",
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
  results: BrowserLiveViewStartResult[];
  sink: BrowserLiveViewSink;
  respond: (result: BrowserLiveViewStartResult) => void;
}

function createViewer(): RecordingViewer {
  const viewer: RecordingViewer = {
    frames: [],
    ended: [],
    results: [],
    sink: {
      sendFrame: (frame) => viewer.frames.push(frame),
      ended: (error) => viewer.ended.push(error),
    },
    respond: (result) => viewer.results.push(result),
  };
  return viewer;
}

function createLiveBroker(): BrowserToolsBroker {
  let sequence = 0;
  return new BrowserToolsBroker({
    defaultTimeoutMs: 100,
    createRequestId: () => `req-${++sequence}`,
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
  browserId?: string;
}): Promise<void> {
  const started = params.broker.startLiveView({
    streamId: params.streamId ?? "stream-1",
    browserId: params.browserId ?? BROWSER_ID,
    viewerId: params.viewerId ?? "viewer-1",
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
      options: {},
      sink: viewer.sink,
      respond: viewer.respond,
    });

    expect(viewer.results).toEqual([
      { ok: false, error: expect.objectContaining({ code: "browser_unsupported" }) },
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
      options: {},
      sink: second.sink,
      respond: second.respond,
    });
    expect(second.results).toEqual([
      { ok: false, error: expect.objectContaining({ code: "browser_denied" }) },
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
      { ok: false, error: { code: "browser_tab_not_found", message: "gone", retryable: false } },
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

    expect(viewer.results).toEqual([{ ok: false, error: expect.anything() }]);
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
      options: {},
      sink: viewer.sink,
      respond: viewer.respond,
    });
    await vi.advanceTimersByTimeAsync(100);
    await started;

    expect(viewer.results).toEqual([
      { ok: false, error: expect.objectContaining({ code: "browser_timeout" }) },
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
      options: {},
      sink: viewer.sink,
      respond: viewer.respond,
    });
    await vi.advanceTimersByTimeAsync(100);
    await started;
    expect(viewer.results).toEqual([
      { ok: false, error: expect.objectContaining({ code: "browser_timeout" }) },
    ]);
    expect(broker.getLiveViewCount()).toBe(0);
    vi.useRealTimers();
  });
});
