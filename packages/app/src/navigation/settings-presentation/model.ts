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
  /** The settings search query; kept across sections so results survive a pick and Back. */
  searchQuery: string;
  reveal: SettingsRevealRequest | null;
}

export function createSettingsPresentation() {
  const store = createStore<SettingsSelectionState>(() => ({
    selectedServerId: null,
    searchQuery: "",
    reveal: null,
  }));
  const enteredRoutes = new Map<string, string>();
  let inSettings = false;
  let sidebarOffset = 0;
  let sidebarOwner: object | null = null;

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
  ): void {
    const isSettings = pathname === "/settings" || pathname.startsWith("/settings/");
    if (!isSettings) {
      sidebarOffset = 0;
      sidebarOwner = null;
      inSettings = false;
      enteredRoutes.clear();
      store.setState({ searchQuery: "", reveal: null });
      return;
    }
    // A retained route returning through Back must not replay its old host intent.
    if (enteredRoutes.get(key) === pathname) return;
    const isNewVisit = !inSettings;
    inSettings = true;
    enteredRoutes.set(key, pathname);

    const hostMatch = /^\/settings\/hosts\/([^/]+)(?:\/|$)/.exec(pathname);
    if (hostMatch) {
      store.setState({ selectedServerId: decodeURIComponent(hostMatch[1]) });
    } else if (isNewVisit) {
      store.setState({ selectedServerId: workspaceServerId });
    }
  }

  function selectHost(serverId: string): void {
    store.setState({ selectedServerId: serverId });
  }

  function setSearchQuery(searchQuery: string): void {
    store.setState({ searchQuery });
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
    setSearchQuery,
    requestReveal,
    claimReveal,
    attachSidebar,
  };
}
