import type { Theme } from "@/styles/theme";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

export function getStatusDotColor(input: {
  theme: Theme;
  bucket: SidebarStateBucket;
  showDoneAsInactive?: boolean;
}): string | null {
  const { theme, bucket, showDoneAsInactive = false } = input;

  // The one place the statusDot* band is read. Dots sit louder than the check icons and host
  // badges on the same row — see the band's note in theme.ts — so going through the status
  // family here instead would quietly put the row's state below its metadata.
  //
  // needs_input is amber because it wants something from you. Working is blue: an agent doing
  // its job is the one busy state that asks for nothing, so it should not sit in the same
  // color as the states that do.
  if (bucket === "needs_input") {
    return theme.colors.statusDotWarning;
  }
  if (bucket === "failed") {
    return theme.colors.statusDotDanger;
  }
  if (bucket === "running") {
    return theme.colors.statusDotRunning;
  }
  if (bucket === "attention") {
    return theme.colors.statusDotSuccess;
  }
  // Blocked is yellow: the work is waiting on something other than you (a PR, CI, another
  // workspace), so it must not look like Done and must not borrow needs_input's amber.
  if (bucket === "blocked") {
    return theme.colors.statusDotBlocked;
  }
  if (bucket === "done") {
    return showDoneAsInactive ? theme.colors.border : null;
  }
  return null;
}
