import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useWorkspaceRecoveryRequestedFromLink } from "@/workspace-recovery/link-requests";
import { ExternalLink } from "./external-link";

const mounted: { root: Root; container: HTMLDivElement }[] = [];

// Navigation itself needs the app router, which this test does not mount.
function ignoreNavigationError() {}

function RecoveryRequested({ serverId, workspaceId }: { serverId: string; workspaceId: string }) {
  const requested = useWorkspaceRecoveryRequestedFromLink(serverId, workspaceId);
  return <span data-testid="requested">{String(requested)}</span>;
}

function mount(node: React.ReactNode): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted.push({ root, container });
  return container;
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("ExternalLink", () => {
  it("opens a paseo:// workspace link in the app", async () => {
    const container = mount(
      <>
        <ExternalLink
          href="paseo://h/srv_link/workspace/wks_link"
          label="Workspace"
          onError={ignoreNavigationError}
        />
        <RecoveryRequested serverId="srv_link" workspaceId="wks_link" />
      </>,
    );
    const link = container.querySelector('[role="link"]');
    if (!(link instanceof HTMLElement)) throw new Error("ExternalLink did not render a link");

    await act(async () => link.click());

    expect(container.querySelector('[data-testid="requested"]')?.textContent).toBe("true");
  });
});
