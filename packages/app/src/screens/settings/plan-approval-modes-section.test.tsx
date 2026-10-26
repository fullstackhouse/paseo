/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";

const { snapshotState, configState, patchConfigMock } = vi.hoisted(() => ({
  snapshotState: { entries: undefined as ProviderSnapshotEntry[] | undefined },
  configState: { config: null as MutableDaemonConfig | null },
  patchConfigMock: vi.fn(async () => undefined),
}));

vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/settings", () => ({
  SettingsSection: ({ title, children }: { title: string; children?: React.ReactNode }) =>
    React.createElement("section", { "aria-label": title }, children),
  SettingsCard: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  SettingsSelect: ({
    label,
    value,
    options,
    onValueChange,
  }: {
    label: string;
    value: string;
    options: Array<{ value: string; label: string }>;
    onValueChange: (value: string) => void;
  }) =>
    React.createElement(
      "select",
      {
        "aria-label": label,
        value,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
          onValueChange(event.target.value),
      },
      options.map((option) =>
        React.createElement("option", { key: option.value, value: option.value }, option.label),
      ),
    ),
}));

vi.mock("@/hooks/use-providers-snapshot", () => ({
  useProvidersSnapshot: () => ({ entries: snapshotState.entries }),
}));

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({ config: configState.config, patchConfig: patchConfigMock }),
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeIsConnected: () => true,
}));

import { PlanApprovalModesSection } from "./plan-approval-modes-section";

function entry(
  provider: string,
  overrides: Partial<ProviderSnapshotEntry> = {},
): ProviderSnapshotEntry {
  return {
    provider,
    status: "ready",
    enabled: true,
    label: provider,
    modes: [
      { id: "plan", label: "Plan" },
      { id: "full-access", label: "Full access" },
    ],
    ...overrides,
  };
}

describe("PlanApprovalModesSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    configState.config = null;
    patchConfigMock.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render() {
    act(() => root.render(React.createElement(PlanApprovalModesSection, { serverId: "host" })));
  }

  function selectLabels() {
    return Array.from(container.querySelectorAll("select")).map((select) =>
      select.getAttribute("aria-label"),
    );
  }

  it("lists only enabled providers that support plan approval", () => {
    snapshotState.entries = [
      entry("claude", { supportsPlanApproval: true }),
      entry("codex", { supportsPlanApproval: true, enabled: false }),
      entry("opencode"),
    ];
    render();
    expect(selectLabels()).toEqual(["claude"]);
    const options = Array.from(container.querySelectorAll("option")).map((option) => option.value);
    expect(options).toEqual(["", "full-access"]);
  });

  it("renders nothing when the daemon does not report plan approval support", () => {
    snapshotState.entries = [entry("claude"), entry("codex")];
    render();
    expect(container.innerHTML).toBe("");
  });

  it("patches the provider config and clears it with null for the provider default", () => {
    snapshotState.entries = [entry("codex", { supportsPlanApproval: true })];
    render();
    const select = container.querySelector("select")!;

    act(() => {
      select.value = "full-access";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => {
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(patchConfigMock.mock.calls).toEqual([
      [{ providers: { codex: { planApprovalModeId: "full-access" } } }],
      [{ providers: { codex: { planApprovalModeId: null } } }],
    ]);
  });
});
