import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, PixelRatio, Text, View, type LayoutChangeEvent } from "react-native";
import { Image } from "expo-image";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { BrowserLiveInput } from "@getpaseo/protocol/browser-automation/live-view";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useKeyboardShiftStyle } from "@/keyboard/shift";
import { useBlockMobilePanelOpenGestures } from "@/mobile-panels/provider";
import type { Theme } from "@/styles/theme";
import {
  createBrowserControl,
  getControlAvailability,
  getScreenScale,
  INITIAL_CONTROL_STATE,
  toScreenPoint,
  type BrowserControl,
  type BrowserControlState,
} from "./control";
import { ControlPanel } from "./control-panel";
import {
  createBrowserLiveView,
  type BrowserLiveView,
  type BrowserLiveViewFrame,
  type BrowserLiveViewOptions,
  type BrowserLiveViewState,
} from "./live-view";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const IDLE: BrowserLiveViewState = { status: "idle" };
const MAX_FRAME_WIDTH = 1280;
// Past this a touch scrolls; short of it, it taps.
const SCROLL_SLOP = 10;
// Reanimated styles and Unistyles must not share a node.
const FILL = { flex: 1, minHeight: 0 } as const;

const ENDED_KEYS: Record<string, string> = {
  connection: "workspace.browser.liveView.ended.connection",
  browser_timeout: "workspace.browser.liveView.ended.connection",
  browser_tab_closed: "workspace.browser.liveView.ended.tabClosed",
  browser_tab_not_found: "workspace.browser.liveView.ended.tabClosed",
  browser_no_host: "workspace.browser.liveView.ended.noDesktop",
  browser_denied: "workspace.browser.liveView.ended.inUse",
  browser_unsupported: "workspace.browser.liveView.ended.unsupported",
};

// Spec defaults: 5 fps at quality 60 is enough to read a page; the width matches the phone's pixels.
function getLiveViewOptions(): BrowserLiveViewOptions {
  const screenPixels = Math.round(Dimensions.get("window").width * PixelRatio.get());
  return { maxFps: 5, jpegQuality: 60, maxWidth: Math.min(MAX_FRAME_WIDTH, screenPixels) };
}

function useBrowserLiveView(input: {
  client: DaemonClient | null;
  browserId: string;
  active: boolean;
}) {
  const { client, browserId, active } = input;
  const [state, setState] = useState<BrowserLiveViewState>(IDLE);
  const [control, setControl] = useState<BrowserControlState>(INITIAL_CONTROL_STATE);
  const viewRef = useRef<BrowserLiveView | null>(null);
  const controlRef = useRef<BrowserControl | null>(null);

  useEffect(() => {
    if (!client) return;
    const browserControl = createBrowserControl({ client, onChange: setControl });
    const view = createBrowserLiveView({
      client,
      subscribeEnded: (handler) =>
        client.on("browser.live.ended", (message) => handler(message.payload)),
      browserId,
      options: getLiveViewOptions(),
      onChange: (next) => {
        setState(next);
        if (next.status === "live") browserControl.setOrigin(next.frame.origin);
      },
      onStreamChange: browserControl.setStream,
    });
    viewRef.current = view;
    controlRef.current = browserControl;
    return () => {
      view.dispose();
      browserControl.dispose();
      viewRef.current = null;
      controlRef.current = null;
      setState(IDLE);
      setControl(INITIAL_CONTROL_STATE);
    };
  }, [client, browserId]);

  useEffect(() => {
    viewRef.current?.setActive(active);
  }, [client, browserId, active]);

  const retry = useCallback(() => viewRef.current?.retry(), []);
  const frameRendered = useCallback((seq: number) => viewRef.current?.frameRendered(seq), []);
  const take = useCallback(() => void controlRef.current?.take(), []);
  const handBack = useCallback(() => void controlRef.current?.handBack(), []);
  const send = useCallback((next: BrowserLiveInput) => void controlRef.current?.send(next), []);
  return { state, control, retry, frameRendered, take, handBack, send };
}

/**
 * Live view of a desktop browser tab: read-only until the user takes control. Streams only while
 * `active`, but the control panel stays mounted, because a password manager backgrounds the app
 * while its text field waits to be filled.
 */
export function LiveViewSurface(props: {
  client: DaemonClient | null;
  browserId: string;
  active: boolean;
  hostSupportsControl: boolean;
}) {
  const { state, control, retry, frameRendered, take, handBack, send } = useBrowserLiveView(props);
  const availability = getControlAvailability(props.hostSupportsControl, control);
  const { style: keyboardPadding } = useKeyboardShiftStyle({ mode: "padding" });
  const containerStyle = useMemo(() => [FILL, keyboardPadding], [keyboardPadding]);
  // A horizontal drag scrolls the page then.
  useBlockMobilePanelOpenGestures(props.active && control.held);

  return (
    <Animated.View style={containerStyle}>
      {state.status === "live" ? (
        <View style={styles.container} testID="browser-live-view">
          <LiveFrame
            frame={state.frame}
            onRendered={frameRendered}
            onInput={control.held ? send : null}
          />
        </View>
      ) : (
        <LiveViewStatus state={state} onRetry={retry} />
      )}
      <ControlPanel
        state={control}
        availability={availability}
        onTake={take}
        onHandBack={handBack}
        onSend={send}
      />
    </Animated.View>
  );
}

function LiveViewStatus(props: { state: BrowserLiveViewState; onRetry: () => void }) {
  const { state, onRetry } = props;
  const { t } = useTranslation();
  if (state.status === "ended") {
    const reason = ENDED_KEYS[state.code ?? ""] ?? "workspace.browser.liveView.ended.failed";
    return (
      <View style={styles.message} testID="browser-live-view-ended">
        <Text style={styles.title}>{t("workspace.browser.liveView.endedTitle")}</Text>
        <Text style={styles.subtitle}>{t(reason)}</Text>
        <Button variant="outline" onPress={onRetry}>
          {t("workspace.browser.liveView.retry")}
        </Button>
      </View>
    );
  }
  return (
    <View style={styles.message} testID="browser-live-view-connecting">
      <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
      <Text style={styles.subtitle}>{t("workspace.browser.liveView.connecting")}</Text>
    </View>
  );
}

function LiveFrame(props: {
  frame: BrowserLiveViewFrame;
  onRendered: (seq: number) => void;
  /** Null while read-only. */
  onInput: ((input: BrowserLiveInput) => void) | null;
}) {
  const { frame, onRendered, onInput } = props;
  const { seq, uri } = frame;
  const { width, height, offsetTop } = frame.screen;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const source = useMemo(() => ({ uri }), [uri]);
  const handleDisplay = useCallback(() => onRendered(seq), [onRendered, seq]);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { layout } = event.nativeEvent;
    setSize({ width: layout.width, height: layout.height });
  }, []);

  const gesture = useMemo(() => {
    const screen = { width, height, offsetTop };
    const tap = Gesture.Tap()
      .runOnJS(true)
      .enabled(onInput !== null)
      .maxDistance(SCROLL_SLOP)
      .onEnd((event, success) => {
        if (!success) return;
        const point = toScreenPoint(event, size, screen);
        if (point) onInput?.({ kind: "tap", ...point });
      });
    const pan = Gesture.Pan()
      .runOnJS(true)
      .enabled(onInput !== null)
      .minDistance(SCROLL_SLOP)
      .maxPointers(1)
      .onEnd((event, success) => {
        if (!success) return;
        const { translationX, translationY } = event;
        const start = { x: event.x - translationX, y: event.y - translationY };
        const point = toScreenPoint(start, size, screen);
        if (!point) return;
        const scale = getScreenScale(size, screen);
        // The page follows the finger, so the wheel turns the other way.
        const deltaX = -translationX / scale;
        const deltaY = -translationY / scale;
        onInput?.({ kind: "scroll", ...point, deltaX, deltaY });
      });
    return Gesture.Race(pan, tap);
  }, [height, offsetTop, onInput, size, width]);

  // expo-image keeps the previous frame on screen until the next one decodes, so frames swap
  // without a blank flash. Frames show authenticated pages: never cache them.
  return (
    <GestureDetector gesture={gesture}>
      <View
        collapsable={false}
        style={styles.frame}
        onLayout={handleLayout}
        testID="browser-live-frame"
      >
        <Image
          source={source}
          style={styles.frame}
          contentFit="contain"
          cachePolicy="none"
          onDisplay={handleDisplay}
          accessibilityIgnoresInvertColors
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  frame: {
    flex: 1,
    width: "100%",
  },
  message: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[4],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    textAlign: "center",
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
