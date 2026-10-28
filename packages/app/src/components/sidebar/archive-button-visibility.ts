/**
 * Whether a workspace row shows its one-click Archive button beside the kebab.
 *
 * Hover only. Touch rows keep the kebab permanently, and a permanent archive button there would
 * sit one mis-tap from archiving while scrolling the list. It also follows the kebab out of the
 * way while shortcut hints are up, so the two never split.
 */
export function shouldShowSidebarArchiveButton({
  enabled,
  showKebab,
  isHovered,
  isTouchPlatform,
}: {
  enabled: boolean;
  showKebab: boolean;
  isHovered: boolean;
  isTouchPlatform: boolean;
}): boolean {
  return enabled && showKebab && isHovered && !isTouchPlatform;
}
