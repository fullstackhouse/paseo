export type HomeTileId =
  | "new-workspace"
  | "add-project"
  | "import-session"
  | "setup-providers"
  | "pair-device";

/**
 * The home screen's tiles, in order. A returning user (any host has a project) gets
 * New workspace first, so the screen leads back into work; a first run keeps the setup
 * tiles only. The first tile carries the accent.
 */
export function resolveHomeTiles(input: {
  hasProjects: boolean;
  canPairDevice: boolean;
}): HomeTileId[] {
  return [
    ...(input.hasProjects ? (["new-workspace"] as const) : []),
    "add-project",
    "import-session",
    "setup-providers",
    ...(input.canPairDevice ? (["pair-device"] as const) : []),
  ];
}
