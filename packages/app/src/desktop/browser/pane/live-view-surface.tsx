import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, PixelRatio, Text, View } from "react-native";
import { Image } from "expo-image";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { Theme } from "@/styles/theme";
import {
  createBrowserLiveView,
  type BrowserLiveView,
  type BrowserLiveViewOptions,
  type BrowserLiveViewState,
} from "./live-view";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const IDLE: BrowserLiveViewState = { status: "idle" };
const MAX_FRAME_WIDTH = 1280;

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
  const viewRef = useRef<BrowserLiveView | null>(null);

  useEffect(() => {
    if (!client) return;
    const view = createBrowserLiveView({
      client,
      subscribeEnded: (handler) =>
        client.on("browser.live.ended", (message) => handler(message.payload)),
      browserId,
      options: getLiveViewOptions(),
      onChange: setState,
    });
    viewRef.current = view;
    return () => {
      view.dispose();
      viewRef.current = null;
      setState(IDLE);
    };
  }, [client, browserId]);

  useEffect(() => {
    viewRef.current?.setActive(active);
  }, [client, browserId, active]);

  const retry = useCallback(() => viewRef.current?.retry(), []);
  const frameRendered = useCallback((seq: number) => viewRef.current?.frameRendered(seq), []);
  return { state, retry, frameRendered };
}

/** Read-only live view of a desktop browser tab. Streams only while `active`. */
export function LiveViewSurface(props: {
  client: DaemonClient | null;
  browserId: string;
  active: boolean;
}) {
  const { state, retry, frameRendered } = useBrowserLiveView(props);

  if (state.status === "live") {
    return (
      <View style={styles.container} testID="browser-live-view">
        <LiveFrame seq={state.frame.seq} uri={state.frame.uri} onRendered={frameRendered} />
      </View>
    );
  }
  if (state.status === "ended") {
    return (
      <View style={styles.message} testID="browser-live-view-ended">
        <Text style={styles.title}>Live view ended</Text>
        <Text style={styles.subtitle}>{state.message}</Text>
        <Button variant="outline" onPress={retry}>
          Retry
        </Button>
      </View>
    );
  }
  return (
    <View style={styles.message} testID="browser-live-view-connecting">
      <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
      <Text style={styles.subtitle}>Connecting to the desktop browser...</Text>
    </View>
  );
}

function LiveFrame(props: { seq: number; uri: string; onRendered: (seq: number) => void }) {
  const { seq, uri, onRendered } = props;
  const source = useMemo(() => ({ uri }), [uri]);
  const handleDisplay = useCallback(() => onRendered(seq), [onRendered, seq]);
  // expo-image keeps the previous frame on screen until the next one decodes, so frames swap
  // without a blank flash. Frames show authenticated pages: never cache them.
  return (
    <Image
      source={source}
      style={styles.frame}
      contentFit="contain"
      cachePolicy="none"
      onDisplay={handleDisplay}
      accessibilityIgnoresInvertColors
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
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
