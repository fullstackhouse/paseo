import type { ReactNode } from "react";
export interface ExplorerFrameProps {
  children: ReactNode;
  presentation: "overlay" | "dock";
  containerWidth: number;
  isOpen: boolean;
  isWorkspaceActive: boolean;
  surfaceColor?: string;
}
