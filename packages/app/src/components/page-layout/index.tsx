import { AppearanceText as Text } from "@/appearance/text";
import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { Platform, ScrollView, View } from "react-native";
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewRef,
} from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { BackHeader } from "@/components/headers/back-header";
import { MenuHeader } from "@/components/headers/menu-header";
import { useIsCompactFormFactor } from "@/constants/layout";
import { SPACING } from "@/styles/theme";
import { PageScrollContext } from "./page-scroll";

export { usePageScroll } from "./page-scroll";

const PageScrollView = Platform.OS === "android" ? KeyboardAwareScrollView : ScrollView;

// How far above a revealed element the page stops, so its section context stays visible.
const REVEAL_TOP_OFFSET = SPACING[16];

interface PageLayoutProps {
  title?: string;
  /** Compact back button. Defaults to navigating back. */
  onBack?: () => void;
  testID?: string;
  titleTestID?: string;
  /** Controls for the whole page: right of the title on desktop, in the back header on compact. */
  actions?: ReactNode;
  /** `wide` for pages that lay content out in a grid, such as a gallery. Defaults to a reading column. */
  width?: "default" | "wide";
  children: ReactNode;
}

/**
 * A full-width page with a centered content column. On desktop the title is a
 * document heading inside the page and the header only keeps the titlebar drag
 * region and window controls; on compact the title moves into a back header.
 */
export function PageLayout({
  title,
  onBack,
  testID,
  titleTestID,
  actions,
  width = "default",
  children,
}: PageLayoutProps) {
  const isCompact = useIsCompactFormFactor();
  const insets = useSafeAreaInsets();
  const scrollContentStyle = useMemo(() => ({ paddingBottom: insets.bottom }), [insets.bottom]);
  const showTitle = !isCompact && title !== undefined;
  // A plain ScrollView off Android: call only ScrollView methods through this ref.
  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);
  const contentRef = useRef<View>(null);
  const scrollToNode = useCallback((node: Pick<View, "measureLayout">) => {
    const content = contentRef.current;
    if (!content) return;
    node.measureLayout(
      content,
      (_x, y) => {
        scrollRef.current?.scrollTo({ y: Math.max(0, y - REVEAL_TOP_OFFSET), animated: true });
      },
      () => {},
    );
  }, []);
  const pageScroll = useMemo(() => ({ scrollToNode }), [scrollToNode]);

  return (
    <View style={styles.container}>
      {isCompact ? (
        <BackHeader title={title} onBack={onBack} rightContent={actions} />
      ) : (
        <MenuHeader borderless />
      )}
      <PageScrollView
        // Leave room for field borders and padding around the focused native input.
        {...(Platform.OS === "android" ? { bottomOffset: SPACING[4] } : {})}
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={scrollContentStyle}
        testID={testID}
      >
        <View ref={contentRef} style={width === "wide" ? styles.contentWide : styles.content}>
          {showTitle ? (
            <View style={styles.titleRow} testID={titleTestID}>
              <Text style={styles.title} testID="page-title">
                {title}
              </Text>
              {actions}
            </View>
          ) : null}
          <PageScrollContext.Provider value={pageScroll}>{children}</PageScrollContext.Provider>
        </View>
      </PageScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: theme.spacing[4],
    paddingTop: theme.spacing[6],
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  contentWide: {
    padding: theme.spacing[4],
    paddingTop: theme.spacing[6],
    width: "100%",
    maxWidth: 1080,
    alignSelf: "center",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[4],
    marginBottom: theme.spacing[6],
  },
  title: {
    // Line up with the section titles, which sit inset from their cards.
    marginLeft: theme.spacing[1],
    fontSize: theme.fontSize["4xl"],
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
}));
