import { useCallback, useLayoutEffect, useRef } from "react";
import { ScrollView, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { usePathname, useRootNavigationState } from "expo-router";
import { useStore } from "zustand";
import {
  useIsLastWorkspaceSelectionHydrated,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { selection } from "./selection";

export { claimSettingsReveal, requestSettingsReveal, useIsSettingsRevealTarget } from "./selection";

// Mount once above the sibling Settings routes so replacements and Back share
// one visit, and leaving Settings gives the next workspace entry a fresh default.
export function useSettingsRouteEntry(): void {
  const pathname = usePathname();
  const navigationState = useRootNavigationState();
  const routeKey = navigationState?.routes[navigationState.index]?.key;
  const workspace = useLastWorkspaceSelection();
  const isWorkspaceHydrated = useIsLastWorkspaceSelectionHydrated();
  const workspaceServerId = workspace?.serverId ?? null;
  useLayoutEffect(() => {
    if (isWorkspaceHydrated && routeKey) {
      selection.enterRoute({ key: routeKey, pathname }, workspaceServerId);
    }
  }, [pathname, routeKey, workspaceServerId, isWorkspaceHydrated]);
}

export function useSettingsHostSelection(): string | null {
  return useStore(selection.store, (state) => state.selectedServerId);
}

export const selectSettingsHost = selection.selectHost;

export function useSettingsSearchQuery(): string {
  return useStore(selection.store, (state) => state.searchQuery);
}

export const setSettingsSearchQuery = selection.setSearchQuery;

export function useSettingsSearchCursor(): number {
  return useStore(selection.store, (state) => state.searchCursor);
}

export const setSettingsSearchCursor = selection.setSearchCursor;
export const markSettingsSearchResultOpened = selection.markResultOpened;
export const handOffSettingsSearchFocus = selection.handOffSearchFocus;
export const takeSettingsSearchFocus = selection.takeSearchFocus;

// Sibling routes remount the wide sidebar. Only the current mount owns its
// offset: RN Web can deliver its final scroll callback after unmount.
export function useSettingsSidebarScroll(enabled: boolean) {
  const ref = useRef<ScrollView>(null);
  const owner = useRef<ReturnType<typeof selection.attachSidebar> | null>(null);
  const restore = useCallback(() => {
    if (owner.current) ref.current?.scrollTo({ y: owner.current.offset, animated: false });
  }, []);
  useLayoutEffect(() => {
    if (!enabled) return;
    const sidebar = selection.attachSidebar();
    owner.current = sidebar;
    restore();
    return () => {
      sidebar.detach();
      owner.current = null;
    };
  }, [enabled, restore]);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    owner.current?.remember(event.nativeEvent.contentOffset.y);
  }, []);
  return { ref, onScroll, onContentSizeChange: restore, scrollEventThrottle: 16 };
}
