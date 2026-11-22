import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { ContextBridge } from "@/components/ui/isolated-bottom-sheet-modal";
import { isNative } from "@/constants/platform";
import { useHostFeature } from "@/runtime/host-features";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";

type OpenLiveView = (browserId: string) => void;

// A context, because history rows re-render only when their item changes, and the link must
// follow the host setting.
const OpenLiveViewContext = createContext<OpenLiveView | null>(null);

/**
 * Lets browser tool rows open their tab's live view. Native only: desktop shows the real tab
 * and the web browser pane has no live view.
 */
export function BrowserLiveViewLinks({
  serverId,
  workspaceId,
  opensWorkspaceTabs = true,
  children,
}: {
  serverId: string;
  workspaceId: string | null | undefined;
  /** False for a conversation shown outside its workspace. */
  opensWorkspaceTabs?: boolean;
  children: ReactNode;
}) {
  const supportsLiveView = useHostFeature(serverId, "browserLiveView");
  const openLiveView = useMemo<OpenLiveView | null>(() => {
    if (!isNative || !supportsLiveView || !opensWorkspaceTabs || !workspaceId) return null;
    return (browserId) => {
      navigateToWorkspace({ serverId, workspaceId, target: { kind: "browser", browserId } });
    };
  }, [opensWorkspaceTabs, serverId, supportsLiveView, workspaceId]);

  return (
    <OpenLiveViewContext.Provider value={openLiveView}>{children}</OpenLiveViewContext.Provider>
  );
}

/** The press handler for a row's link, or undefined when the row has none. */
export function useViewLive(browserId: string | null): (() => void) | undefined {
  const openLiveView = useContext(OpenLiveViewContext);
  return useMemo(() => {
    if (!browserId || !openLiveView) return undefined;
    return () => openLiveView(browserId);
  }, [browserId, openLiveView]);
}

/** Carries the links into a sheet, which closes first so it doesn't cover the opened tab. */
export function useBrowserLiveViewLinksBridge(closeSheet: () => void): ContextBridge {
  const openLiveView = useContext(OpenLiveViewContext);
  const openFromSheet = useMemo<OpenLiveView | null>(() => {
    if (!openLiveView) return null;
    return (browserId) => {
      closeSheet();
      openLiveView(browserId);
    };
  }, [closeSheet, openLiveView]);
  return useCallback(
    (content) => (
      <OpenLiveViewContext.Provider value={openFromSheet}>{content}</OpenLiveViewContext.Provider>
    ),
    [openFromSheet],
  );
}
