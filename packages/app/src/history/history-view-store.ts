import { create } from "zustand";

export type HistoryView = "agents" | "archived";

interface HistoryViewStoreState {
  view: HistoryView;
  setView: (view: HistoryView) => void;
}

/**
 * The History tab the user picked. The screen's content unmounts whenever History loses focus,
 * so keeping this in component state sent Back from an archived workspace to Agents.
 */
export const useHistoryViewStore = create<HistoryViewStoreState>((set) => ({
  view: "agents",
  setView: (view) => set({ view }),
}));

/** The History tab, kept across the remount History's content goes through on every focus. */
export function useHistoryView(): { view: HistoryView; setView: (view: HistoryView) => void } {
  const view = useHistoryViewStore((state) => state.view);
  const setView = useHistoryViewStore((state) => state.setView);
  return { view, setView };
}
