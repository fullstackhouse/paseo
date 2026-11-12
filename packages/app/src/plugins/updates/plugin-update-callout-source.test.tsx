/** @vitest-environment jsdom */
import type {
  PluginUpdatePreview,
  PluginUpdateProposal,
  PluginUpdateResult,
} from "@getpaseo/protocol/messages";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SidebarCalloutOptions } from "@/contexts/sidebar-callout-context";
import { PluginUpdateCalloutSource } from "./plugin-update-callout-source";

const host = vi.hoisted(() => ({ connected: true, supported: true }));
const rpc = vi.hoisted(() => ({
  previewPluginUpdates: vi.fn<() => Promise<PluginUpdatePreview[]>>(),
  applyPluginUpdates: vi.fn<(proposals: PluginUpdateProposal[]) => Promise<PluginUpdateResult[]>>(),
  observeEvents: vi.fn(),
}));
const callouts = vi.hoisted(() => ({
  show: vi.fn<(options: SidebarCalloutOptions) => () => void>(),
}));

vi.mock("@/contexts/sidebar-callout-context", () => ({ useSidebarCallouts: () => callouts }));
vi.mock("@/runtime/host-features", () => ({ useHostFeature: () => host.supported }));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [{ serverId: "host-1", label: "MacBook" }],
  useHostRuntimeClient: () => rpc,
  useHostRuntimeIsConnected: () => host.connected,
}));

function update(commit = "b".repeat(40), id = "example"): PluginUpdatePreview {
  return {
    id,
    outcome: "update",
    links: [],
    proposal: {
      id,
      expected: {
        identity: { kind: "git", remote: "https://github.com/acme/example", pluginPath: "" },
        installationRoot: "/plugins/example",
        revision: "a".repeat(40),
      },
      target: { kind: "git", commit },
    },
  };
}

let queryClient: QueryClient;
let catalogChanged: () => void;

function mount() {
  return render(
    <QueryClientProvider client={queryClient}>
      <PluginUpdateCalloutSource />
    </QueryClientProvider>,
  );
}

async function settle() {
  await waitFor(() => {
    expect(queryClient.isFetching()).toBe(0);
    expect(queryClient.isMutating()).toBe(0);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  host.connected = true;
  host.supported = true;
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  callouts.show.mockImplementation(() => () => {});
  rpc.previewPluginUpdates.mockResolvedValue([update()]);
  rpc.applyPluginUpdates.mockImplementation(async () => {
    rpc.previewPluginUpdates.mockResolvedValue([{ id: "example", outcome: "current", links: [] }]);
    return [{ id: "example", outcome: "updated" }];
  });
  rpc.observeEvents.mockReturnValue({
    subscribe: ({ update: onUpdate }: { update: (message: unknown) => void }) => {
      catalogChanged = () =>
        onUpdate({ type: "status", payload: { status: "plugin_catalog_changed" } });
    },
    release: async () => {},
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe("automatic plugin updates", () => {
  it("applies available updates without a click or callout", async () => {
    mount();
    await waitFor(() => expect(rpc.applyPluginUpdates).toHaveBeenCalledWith([update().proposal]));
    await settle();
    expect(callouts.show).not.toHaveBeenCalled();
    expect(rpc.applyPluginUpdates).toHaveBeenCalledTimes(1);
  });

  it("ignores directory, current, installed-newer and failed previews", async () => {
    rpc.previewPluginUpdates.mockResolvedValue([
      { id: "local", outcome: "local", links: [] },
      { id: "current", outcome: "current", links: [] },
      { id: "newer", outcome: "installed-newer", links: [] },
      { id: "failed", outcome: "error", error: "offline", links: [] },
    ]);
    mount();
    await waitFor(() => expect(rpc.previewPluginUpdates).toHaveBeenCalledTimes(1));
    await settle();
    expect(rpc.applyPluginUpdates).not.toHaveBeenCalled();
    expect(callouts.show).not.toHaveBeenCalled();
  });

  it("does not apply twice when the catalog changes during an update", async () => {
    let complete!: (results: PluginUpdateResult[]) => void;
    rpc.applyPluginUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    mount();
    await waitFor(() => expect(rpc.applyPluginUpdates).toHaveBeenCalledTimes(1));
    act(() => catalogChanged());
    await waitFor(() => expect(rpc.previewPluginUpdates).toHaveBeenCalledTimes(2));
    expect(rpc.applyPluginUpdates).toHaveBeenCalledTimes(1);
    expect(callouts.show).not.toHaveBeenCalled();
    rpc.previewPluginUpdates.mockResolvedValue([{ id: "example", outcome: "current", links: [] }]);
    await act(async () => complete([{ id: "example", outcome: "updated" }]));
    await settle();
    expect(rpc.applyPluginUpdates).toHaveBeenCalledTimes(1);
  });

  it.each(["connected", "supported"] as const)(
    "does not apply cached updates when %s is false",
    async (gate) => {
      host[gate] = false;
      queryClient.setQueryData(["plugin-update-preview", "host-1"], [update()]);
      mount();
      await settle();
      expect(rpc.previewPluginUpdates).not.toHaveBeenCalled();
      expect(rpc.applyPluginUpdates).not.toHaveBeenCalled();
      expect(callouts.show).not.toHaveBeenCalled();
    },
  );

  it("does not loop after failure and lets the user retry", async () => {
    rpc.applyPluginUpdates.mockResolvedValueOnce([
      { id: "example", outcome: "error", error: "build failed" },
    ]);
    mount();
    await waitFor(() => expect(callouts.show).toHaveBeenCalled());
    await settle();
    act(() => catalogChanged());
    await settle();
    expect(rpc.applyPluginUpdates).toHaveBeenCalledTimes(1);
    const failure = callouts.show.mock.calls.at(-1)![0];
    expect(failure).toMatchObject({ variant: "error", description: "example: build failed" });
    act(() => failure.actions![0].onPress());
    await waitFor(() => expect(rpc.applyPluginUpdates).toHaveBeenCalledTimes(2));
    await settle();
  });

  it("retains a failed plugin's retry after another plugin updates successfully", async () => {
    let visible: SidebarCalloutOptions | null = null;
    callouts.show.mockImplementation((options) => {
      visible = options;
      return () => {
        visible = null;
      };
    });
    rpc.applyPluginUpdates.mockResolvedValueOnce([
      { id: "example", outcome: "error", error: "build failed" },
    ]);
    mount();
    await waitFor(() => expect(visible?.description).toBe("example: build failed"));
    await settle();
    const second = update("c".repeat(40), "second");
    rpc.previewPluginUpdates.mockResolvedValue([update(), second]);
    rpc.applyPluginUpdates.mockImplementationOnce(async () => {
      rpc.previewPluginUpdates.mockResolvedValue([update()]);
      return [{ id: "second", outcome: "updated" }];
    });
    act(() => catalogChanged());
    await waitFor(() => expect(rpc.applyPluginUpdates).toHaveBeenCalledTimes(2));
    await settle();
    expect(rpc.applyPluginUpdates).toHaveBeenLastCalledWith([second.proposal]);
    expect(visible).toMatchObject({ description: "example: build failed" });
    act(() => visible!.actions![0].onPress());
    await waitFor(() => expect(rpc.applyPluginUpdates).toHaveBeenCalledTimes(3));
    expect(rpc.applyPluginUpdates).toHaveBeenLastCalledWith([update().proposal]);
    await settle();
    expect(visible).toBeNull();
  });

  it("does not retry a dismissed failure, but does install a newer target", async () => {
    rpc.applyPluginUpdates.mockResolvedValueOnce([
      { id: "example", outcome: "error", error: "build failed" },
    ]);
    mount();
    await waitFor(() => expect(callouts.show).toHaveBeenCalled());
    await settle();
    act(() => callouts.show.mock.calls.at(-1)![0].onDismiss!());
    act(() => catalogChanged());
    await settle();
    expect(rpc.applyPluginUpdates).toHaveBeenCalledTimes(1);
    rpc.previewPluginUpdates.mockResolvedValue([update("c".repeat(40))]);
    act(() => catalogChanged());
    await waitFor(() => expect(rpc.applyPluginUpdates).toHaveBeenCalledTimes(2));
    expect(rpc.applyPluginUpdates).toHaveBeenLastCalledWith([update("c".repeat(40)).proposal]);
    await settle();
  });
});
