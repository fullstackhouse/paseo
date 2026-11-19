import { createContext, useContext } from "react";
import type { View } from "react-native";

export interface PageScroll {
  /** Scrolls the page so `node` sits near the top. No-op when it isn't inside this page. */
  scrollToNode: (node: Pick<View, "measureLayout">) => void;
}

export const PageScrollContext = createContext<PageScroll | null>(null);

/** The enclosing PageLayout's scroll, or null outside one. */
export function usePageScroll(): PageScroll | null {
  return useContext(PageScrollContext);
}
