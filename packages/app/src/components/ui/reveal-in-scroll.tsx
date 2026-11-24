import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ForwardedRef,
  type ReactNode,
  type RefObject,
} from "react";
import {
  View,
  type LayoutChangeEvent,
  type ScrollView,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { getScrollOffsetToRevealItem } from "./scroll-reveal";

/** Scrolls the nearest scroll container that provides it so `target` is visible. */
export type RevealInScroll = (target: View | null) => void;

const noop: RevealInScroll = () => {};
const RevealContext = createContext<RevealInScroll>(noop);

/** No-op outside a scroll container that wraps its content in `ScrollRevealContent`. */
export function useRevealInScroll(): RevealInScroll {
  return useContext(RevealContext);
}

/** A scroll view ref for `ScrollRevealContent` that also feeds a forwarded ref. */
export function useRevealScrollRef(
  forwarded: ForwardedRef<ScrollView>,
): [RefObject<ScrollView | null>, (node: ScrollView | null) => void] {
  const scrollRef = useRef<ScrollView | null>(null);
  const setRef = useCallback(
    (node: ScrollView | null) => {
      scrollRef.current = node;
      if (typeof forwarded === "function") forwarded(node);
      else if (forwarded) forwarded.current = node;
    },
    [forwarded],
  );
  return [scrollRef, setRef];
}

/**
 * Wraps a scroll container's content so descendants can reveal themselves with `useRevealInScroll`.
 * The view is measured against this wrapper (content coordinates on every platform) and against the
 * scroll view's window frame (where the viewport is now), so no scroll offset has to be tracked.
 * Measuring waits a frame: callers usually reveal right after a state change that moves layout.
 */
export function ScrollRevealContent({
  scrollRef,
  style,
  children,
}: {
  scrollRef: RefObject<ScrollView | null>;
  /** For a content container that stretches its child, such as `flexGrow: 1`. */
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const contentRef = useRef<View>(null);
  // The wrapper's offset inside the scroll content: the container's padding and anything above it.
  const wrapperY = useRef(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    wrapperY.current = event.nativeEvent.layout.y;
  }, []);
  const reveal = useCallback<RevealInScroll>(
    (target) => {
      void nextFrame().then(() =>
        scrollToReveal({
          target,
          scroll: scrollRef.current,
          content: contentRef.current,
          wrapperY,
        }),
      );
    },
    [scrollRef],
  );
  return (
    <RevealContext.Provider value={reveal}>
      <View ref={contentRef} style={style} collapsable={false} onLayout={onLayout}>
        {children}
      </View>
    </RevealContext.Provider>
  );
}

async function scrollToReveal(input: {
  target: View | null;
  scroll: ScrollView | null;
  content: View | null;
  wrapperY: RefObject<number>;
}): Promise<void> {
  const { target, scroll, content, wrapperY } = input;
  // The scroll view's own host view: where its viewport sits in the window now.
  const viewport = scroll?.getNativeScrollRef?.();
  if (!target || !scroll || !viewport || !content) return;
  const [item, itemInWindow, viewportInWindow] = await Promise.all([
    measureIn(target, content),
    measureInWindow(target),
    measureInWindow(viewport),
  ]);
  const itemTop = wrapperY.current + item.y;
  const currentOffset = itemTop - (itemInWindow.y - viewportInWindow.y);
  const next = getScrollOffsetToRevealItem({
    currentOffset,
    viewportHeight: viewportInWindow.height,
    itemTop,
    itemHeight: item.height,
  });
  if (Math.abs(next - currentOffset) >= 1) scroll.scrollTo({ y: next, animated: true });
}

interface Frame {
  y: number;
  height: number;
}

type Measurable = Pick<View, "measureInWindow">;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function measureIn(target: View, ancestor: View): Promise<Frame> {
  return new Promise((resolve) =>
    target.measureLayout(ancestor, (_x, y, _width, height) => resolve({ y, height })),
  );
}

function measureInWindow(target: Measurable): Promise<Frame> {
  return new Promise((resolve) =>
    target.measureInWindow((_x, y, _width, height) => resolve({ y, height })),
  );
}
