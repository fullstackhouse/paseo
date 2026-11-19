import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import { createStore } from "zustand/vanilla";

interface SettingsRouteEntry {
  key: string;
  pathname: string;
}

/** A setting row to scroll to and highlight once its section shows it. */
export interface SettingsRevealRequest {
  title: string;
  token: number;
  expiresAt: number;
}

// A row that never renders (gated off on this host or platform) must not
// reveal itself on some later visit.
export const SETTINGS_REVEAL_TTL_MS = 3000;

interface SettingsSelectionState {
  selectedServerId: string | null;
  sidebarReturn: (ActiveWorkspaceSelection & { phase: "opening" | "covered" }) | null;
  /** The settings search query; kept across sections so results survive a pick and Back. */
  searchQuery: string;
  /** The highlighted search result; back to the top result whenever the query changes. */
  searchCursor: number;
  reveal: SettingsRevealRequest | null;
}

export function createSettingsPresentation() {
  const store = createStore<SettingsSelectionState>(() => ({
    selectedServerId: null,
    sidebarReturn: null,
    searchQuery: "",
    searchCursor: 0,
    reveal: null,
  }));
  const enteredRoutes = new Map<string, string>();
  let inSettings = false;
  let sidebarOffset = 0;
  let sidebarOwner: object | null = null;
  // Opening a section remounts the wide sidebar and its search field. These carry
  // the last result opened and the field's focus across that remount.
  let openedResultId: string | null = null;
  let searchFocusHandoff = false;

  function beginSidebarVisit(workspace: ActiveWorkspaceSelection) {
    store.setState({ sidebarReturn: { ...workspace, phase: "opening" } });
  }

  function presentContent() {
    const origin = store.getState().sidebarReturn;
    if (origin?.phase === "opening") {
      store.setState({ sidebarReturn: { ...origin, phase: "covered" } });
    }
  }

  function clearSidebarReturn() {
    if (store.getState().sidebarReturn) store.setState({ sidebarReturn: null });
  }

  function attachSidebar() {
    const owner = {};
    sidebarOwner = owner;
    return {
      get offset() {
        return sidebarOffset;
      },
      remember(offset: number) {
        if (sidebarOwner === owner) sidebarOffset = offset;
      },
      detach() {
        if (sidebarOwner === owner) sidebarOwner = null;
      },
    };
  }

  function enterRoute(
    { key, pathname }: SettingsRouteEntry,
    workspaceServerId: string | null,
  ): boolean {
    const isSettings = pathname === "/settings" || pathname.startsWith("/settings/");
    if (!isSettings) {
      const origin = store.getState().sidebarReturn;
      const destination = parseHostWorkspaceRouteFromPathname(pathname);
      const discardSidebar =
        origin !== null &&
        (origin.serverId !== destination?.serverId ||
          origin.workspaceId !== destination?.workspaceId);
      clearSidebarReturn();
      sidebarOffset = 0;
      sidebarOwner = null;
      inSettings = false;
      enteredRoutes.clear();
      openedResultId = null;
      searchFocusHandoff = false;
      store.setState({ searchQuery: "", searchCursor: 0, reveal: null });
      return discardSidebar;
    }
    // A retained route returning through Back must not replay its old host intent.
    if (enteredRoutes.get(key) === pathname) return false;
    const isNewVisit = !inSettings;
    inSettings = true;
    enteredRoutes.set(key, pathname);

    const hostMatch = /^\/settings\/hosts\/([^/]+)(?:\/|$)/.exec(pathname);
    if (hostMatch) {
      store.setState({ selectedServerId: decodeURIComponent(hostMatch[1]) });
    } else if (isNewVisit) {
      store.setState({ selectedServerId: workspaceServerId });
    }
    return false;
  }

  function selectHost(serverId: string): void {
    store.setState({ selectedServerId: serverId });
  }

  function setSearchQuery(searchQuery: string): void {
    if (searchQuery === store.getState().searchQuery) return;
    if (!searchQuery.trim()) openedResultId = null;
    store.setState({ searchQuery, searchCursor: 0 });
  }

  function setSearchCursor(searchCursor: number): void {
    store.setState({ searchCursor });
  }

  /** True when `id` differs from the result opened last, so each result opens once per highlight. */
  function markResultOpened(id: string): boolean {
    if (openedResultId === id) return false;
    openedResultId = id;
    return true;
  }

  function handOffSearchFocus(): void {
    searchFocusHandoff = true;
  }

  /** True once after `handOffSearchFocus`, for the search field that mounts next. */
  function takeSearchFocus(): boolean {
    const handoff = searchFocusHandoff;
    searchFocusHandoff = false;
    return handoff;
  }

  let revealToken = 0;
  function requestReveal(title: string, now = Date.now()): void {
    revealToken += 1;
    store.setState({
      reveal: { title, token: revealToken, expiresAt: now + SETTINGS_REVEAL_TTL_MS },
    });
  }

  /** Claims the pending reveal for `title`; true for exactly one caller per request. */
  function claimReveal(title: string, now = Date.now()): boolean {
    const { reveal } = store.getState();
    if (!reveal || reveal.title !== title) return false;
    store.setState({ reveal: null });
    return now <= reveal.expiresAt;
  }

  return {
    store,
    enterRoute,
    selectHost,
    attachSidebar,
    beginSidebarVisit,
    clearSidebarReturn,
    presentContent,
    setSearchQuery,
    setSearchCursor,
    markResultOpened,
    handOffSearchFocus,
    takeSearchFocus,
    requestReveal,
    claimReveal,
  };
}
