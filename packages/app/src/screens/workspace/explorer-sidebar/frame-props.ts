import type { ReactNode } from "react";
export interface ExplorerFrameProps {
  children: ReactNode;
  presentation: "overlay" | "dock";
  isOpen: boolean;
  isWorkspaceActive: boolean;
  surfaceColor?: string;
}
