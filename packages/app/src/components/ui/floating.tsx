import {
  forwardRef,
  useMemo,
  useRef,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  ScrollView,
  StyleSheet,
  type ScrollViewProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from "react-native";
import Animated from "react-native-reanimated";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { ScrollRevealContent } from "./reveal-in-scroll";

export interface FloatingSurfaceProps extends Omit<ComponentProps<typeof Animated.View>, "style"> {
  frameStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}

export const FloatingSurface = forwardRef<View, FloatingSurfaceProps>(function FloatingSurface(
  { frameStyle, style, ...props },
  ref,
): ReactElement {
  const inlineFrameStyle = useMemo(() => {
    const flattened = StyleSheet.flatten(frameStyle);
    return flattened ? inlineUnistylesStyle(stripUnistylesMetadata(flattened)) : undefined;
  }, [frameStyle]);
  const surfaceStyle = useMemo(
    () => appendStyle(style, inlineFrameStyle),
    [inlineFrameStyle, style],
  );
  return <Animated.View {...props} ref={ref} style={surfaceStyle} />;
});

export interface FloatingScrollViewProps {
  bounces?: boolean;
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  keyboardShouldPersistTaps?: ScrollViewProps["keyboardShouldPersistTaps"];
  showsVerticalScrollIndicator?: boolean;
  style?: StyleProp<ViewStyle>;
}

// The content container may stretch its child (the menu's `flexGrow: 1`); keep that through the wrapper.
const REVEAL_CONTENT_STYLE = { flexGrow: 1 } as const;

export function FloatingScrollView({
  bounces,
  children,
  contentContainerStyle,
  keyboardShouldPersistTaps,
  showsVerticalScrollIndicator,
  style,
}: FloatingScrollViewProps): ReactElement {
  const inlineStyle = useMemo(() => {
    const flattened = StyleSheet.flatten(style);
    return flattened ? inlineUnistylesStyle(stripUnistylesMetadata(flattened)) : undefined;
  }, [style]);
  const scrollRef = useRef<ScrollView>(null);

  return (
    <ScrollView
      ref={scrollRef}
      bounces={bounces}
      contentContainerStyle={contentContainerStyle}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      style={inlineStyle}
    >
      <ScrollRevealContent scrollRef={scrollRef} style={REVEAL_CONTENT_STYLE}>
        {children}
      </ScrollRevealContent>
    </ScrollView>
  );
}

function appendStyle(
  style: StyleProp<ViewStyle>,
  extraStyle: ViewStyle | undefined,
): StyleProp<ViewStyle> {
  if (!extraStyle) {
    return style;
  }
  if (Array.isArray(style)) {
    return [...style, extraStyle];
  }
  return [style, extraStyle];
}

function stripUnistylesMetadata(style: ViewStyle): ViewStyle {
  const cleanStyle: Record<string, unknown> = { ...style };
  for (const key of Object.keys(cleanStyle)) {
    if (key.startsWith("unistyles_")) {
      delete cleanStyle[key];
    }
  }
  return cleanStyle as ViewStyle;
}
