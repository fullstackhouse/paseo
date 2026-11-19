import { useStore } from "zustand";
import { settingsPresentation } from "./session";

// The one Settings visit. Kept apart from index.ts, which pulls in routing,
// so settings primitives can read the reveal request without it.
export const selection = settingsPresentation;

/** Asks the settings row titled `title` to scroll into view and flash once it renders. */
export const requestSettingsReveal = selection.requestReveal;
export const claimSettingsReveal = selection.claimReveal;

export function useIsSettingsRevealTarget(title: string | null): boolean {
  return useStore(selection.store, (state) => title !== null && state.reveal?.title === title);
}
