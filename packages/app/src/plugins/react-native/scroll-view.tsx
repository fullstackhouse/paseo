import { forwardRef, type Ref } from "react";
import { ScrollRevealContent, useRevealScrollRef } from "@/components/ui/reveal-in-scroll";
import {
  Platform,
  type ScrollView as NativeScrollView,
  type ScrollViewProps,
  type FlatListProps,
  type FlatList as NativeFlatList,
} from "react-native";
import type * as Shared from "@/components/ui/scroll-view";
import type * as SheetScope from "@/components/ui/bottom-sheet-scope";
import type * as KeyboardController from "react-native-keyboard-controller";
import type * as Theme from "@/styles/theme";

// Plugin evaluation also runs before the native UI is ready. Load presentation
// dependencies at render time, as Modal does, rather than evaluating them on import.
export const ScrollView = forwardRef<NativeScrollView, ScrollViewProps>(function ScrollView(
  { children, ...props },
  forwardedRef,
) {
  // Vertical content can reveal a view with useRevealInScroll; horizontal tabs keep their children as is.
  const [scrollRef, ref] = useRevealScrollRef(forwardedRef);
  const content = props.horizontal ? (
    children
  ) : (
    <ScrollRevealContent scrollRef={scrollRef}>{children}</ScrollRevealContent>
  );
  const { ScrollView: HostScrollView } =
    require("../../components/ui/scroll-view") as typeof Shared;
  const { useIsInsideBottomSheet } =
    require("../../components/ui/bottom-sheet-scope") as typeof SheetScope;
  const inSheet = useIsInsideBottomSheet();
  // Android's keyboard controller owns the keyboard insets, so a plain scroll view leaves a
  // focused plugin input (an Asks reply) under the keyboard. Match PageLayout.
  if (Platform.OS === "android" && !inSheet && !props.horizontal) {
    const { KeyboardAwareScrollView } =
      require("react-native-keyboard-controller") as typeof KeyboardController;
    const { SPACING } = require("../../styles/theme") as typeof Theme;
    // Its instance is a ScrollView with one extra method, so the plugin's ScrollView ref fits.
    const keyboardRef = ref as Ref<KeyboardController.KeyboardAwareScrollViewRef>;
    return (
      <KeyboardAwareScrollView bottomOffset={SPACING[4]} {...props} ref={keyboardRef}>
        {content}
      </KeyboardAwareScrollView>
    );
  }
  return (
    <HostScrollView {...props} ref={ref}>
      {content}
    </HostScrollView>
  );
});

export const FlatList = forwardRef<NativeFlatList<unknown>, FlatListProps<unknown>>(
  function FlatList(props, ref) {
    const { FlatList: HostFlatList } = require("../../components/ui/scroll-view") as typeof Shared;
    return <HostFlatList {...props} ref={ref} />;
  },
) as typeof Shared.FlatList;
