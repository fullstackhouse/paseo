import { useEffect, useMemo, useRef, useState } from "react";
import type { Text, TextProps } from "react-native";
import { AppearanceText } from "@/appearance/text";
import { StyleSheet } from "react-native-unistyles";
import { usePageScroll } from "@/components/page-layout/page-scroll";
import {
  claimSettingsReveal,
  useIsSettingsRevealTarget,
} from "@/navigation/settings-presentation/selection";

const HIGHLIGHT_MS = 1600;

/**
 * A settings row or section title that settings search can jump to. When the
 * search asks for this exact title, it scrolls the page to it and briefly
 * highlights it. Use it for every row and section title a search result can
 * name, so the result lands on the row instead of the top of the page.
 */
export function SettingsRevealText({ style, children, ...props }: TextProps) {
  const title = typeof children === "string" ? children : null;
  const isTarget = useIsSettingsRevealTarget(title);
  const pageScroll = usePageScroll();
  const ref = useRef<Text>(null);
  const [isHighlighted, setIsHighlighted] = useState(false);

  useEffect(() => {
    if (!isTarget || title === null) return;
    // Two frames: the section that just mounted needs to finish its layout
    // before the row's offset means anything.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (!claimSettingsReveal(title)) return;
        if (ref.current) pageScroll?.scrollToNode(ref.current);
        setIsHighlighted(true);
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [isTarget, title, pageScroll]);

  useEffect(() => {
    if (!isHighlighted) return;
    const timer = setTimeout(() => setIsHighlighted(false), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [isHighlighted]);

  const textStyle = useMemo(
    () => [style, isHighlighted && styles.highlight],
    [style, isHighlighted],
  );

  return (
    <AppearanceText ref={ref} style={textStyle} {...props}>
      {children}
    </AppearanceText>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Padding is cancelled by a negative margin so the text doesn't move.
  highlight: {
    backgroundColor: theme.colors.surface3,
    borderRadius: theme.borderRadius.sm,
    marginHorizontal: -theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
  },
}));
