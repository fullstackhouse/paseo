import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Pressable } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SIDEBAR_CHECKS_DISPLAY } from "@/components/sidebar/display-preferences/checks-display";
import { DEFAULT_SIDEBAR_ROW_ITEMS } from "@/components/sidebar/display-preferences/row-items";
import type { PrHint } from "@/git/pr-hint";
import { openExternalUrl } from "@/utils/open-external-url";
import { WorkspaceMetaRow } from "./index";

vi.mock("@/utils/open-external-url", () => ({ openExternalUrl: vi.fn() }));

// The row reads its visible items from app settings; the defaults show the pull request.
vi.mock("@/components/sidebar/display-preferences/model", () => ({
  useSidebarMetaPreferences: () => ({
    rowItems: DEFAULT_SIDEBAR_ROW_ITEMS,
    checksDisplay: DEFAULT_SIDEBAR_CHECKS_DISPLAY,
  }),
}));

// Plugin row items pull in the app's toast host, which imports native-only modules. A row with
// no `workspace` renders none of them anyway.
vi.mock("@/plugins/workspace-row-badge-items", () => ({
  usePluginWorkspaceRowBadgeItems: () => [],
  PluginWorkspaceRowBadgeItems: () => null,
}));

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

const mounted: { root: Root; container: HTMLDivElement }[] = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  vi.mocked(openExternalUrl).mockClear();
});

const OPEN_PR: PrHint = {
  url: "https://github.com/acme/app/pull/42",
  number: 42,
  state: "open",
  forge: "github",
};

describe("WorkspaceMetaRow", () => {
  it("lets a click on the pull request number select the row instead of opening the PR", () => {
    const onRowPress = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <Pressable onPress={onRowPress}>
          <WorkspaceMetaRow
            currentBranch={null}
            projectName={null}
            hostBadge={null}
            prHint={OPEN_PR}
            serviceSummary={null}
            backdrop="surfaceSidebar"
          />
        </Pressable>,
      ),
    );
    mounted.push({ root, container });

    // The innermost element with the number's text, found that way rather than by the new test id
    // so the same test runs against the old link. Every ancestor up to the row has the same text.
    const pr = Array.from(container.querySelectorAll("div")).findLast(
      (el) => el.textContent === "42",
    );
    expect(pr).toBeInstanceOf(HTMLElement);
    act(() => pr?.click());

    expect(onRowPress).toHaveBeenCalledTimes(1);
    expect(openExternalUrl).not.toHaveBeenCalled();
  });
});
