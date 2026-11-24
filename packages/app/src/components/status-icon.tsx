import { useMemo, type ReactElement, type ReactNode } from "react";
import { View } from "react-native";
import { CircleAlert, CirclePause } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import type { SurfaceBackdrop } from "@/styles/surface-backdrop";
import { getStatusDotColor } from "@/utils/status-dot-color";
import { StatusRing } from "@/components/status-ring";
import { getStatusRingOffset } from "@/components/status-ring/geometry";
import {
  STATUS_INDICATOR_ALERT_SIZE,
  STATUS_INDICATOR_DOT_SIZE,
} from "@/utils/status-indicator-geometry";
import type { Theme } from "@/styles/theme";

interface StatusIconProps {
  children: ReactNode;
  statusBucket: SidebarStateBucket | null;
  size?: number;
  statusDotBorderColor?: string;
  backdrop: SurfaceBackdrop;
}
const DEFAULT_STATUS_DOT_OFFSET = -2;
const STATUS_ALERT_OFFSET = -3;
const ThemedCircleAlert = withUnistyles(CircleAlert);
const ThemedCirclePause = withUnistyles(CirclePause);
const needsInputAlertMapping = (theme: Theme) => ({
  color: theme.colors.surface0,
  fill: getStatusDotColor({ theme, bucket: "needs_input" }) ?? undefined,
});
// Outlined, matching the sidebar's blocked glyph.
const blockedAlertMapping = (theme: Theme) => ({
  color: getStatusDotColor({ theme, bucket: "blocked" }) ?? undefined,
});

export function StatusIcon({
  children,
  statusBucket,
  size = 14,
  statusDotBorderColor,
  backdrop,
}: StatusIconProps): ReactElement {
  const bucket = statusBucket;
  const isRunning = bucket === "running";
  let statusDotColor: string | undefined;
  if (bucket === "failed") statusDotColor = styles.statusDotFailed.color;
  else if (bucket === "attention") statusDotColor = styles.statusDotAttention.color;
  const showNeedsInputAlert = bucket === "needs_input";
  const showBlockedAlert = bucket === "blocked";
  const agentIconWrapperStyle = useMemo(
    () => [styles.agentIconWrapper, { width: size, height: size }],
    [size],
  );
  const statusDotStyle = useMemo(
    () => [
      styles.statusDot,
      {
        backgroundColor: statusDotColor,
        borderColor: statusDotBorderColor ?? styles[backdrop].borderColor,
      },
    ],
    [statusDotColor, statusDotBorderColor, backdrop],
  );

  return (
    <View style={agentIconWrapperStyle}>
      {children}
      {isRunning ? (
        <View
          style={styles.statusRing}
          accessibilityRole="progressbar"
          accessibilityLabel="Agent running"
        >
          <StatusRing backdrop={backdrop} />
        </View>
      ) : null}
      {statusDotColor ? <View style={statusDotStyle} /> : null}
      {showNeedsInputAlert ? (
        <View style={styles.statusAlertOverlay}>
          <ThemedCircleAlert size={STATUS_INDICATOR_ALERT_SIZE} uniProps={needsInputAlertMapping} />
        </View>
      ) : null}
      {showBlockedAlert ? (
        <View
          style={[styles.statusAlertOverlay, styles.statusAlertKnockout, knockoutStyles[backdrop]]}
        >
          <ThemedCirclePause size={STATUS_INDICATOR_ALERT_SIZE} uniProps={blockedAlertMapping} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  agentIconWrapper: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  statusDot: {
    position: "absolute",
    right: DEFAULT_STATUS_DOT_OFFSET,
    bottom: DEFAULT_STATUS_DOT_OFFSET,
    width: STATUS_INDICATOR_DOT_SIZE,
    height: STATUS_INDICATOR_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
  },
  statusRing: {
    position: "absolute",
    right: getStatusRingOffset(DEFAULT_STATUS_DOT_OFFSET, STATUS_INDICATOR_DOT_SIZE),
    bottom: getStatusRingOffset(DEFAULT_STATUS_DOT_OFFSET, STATUS_INDICATOR_DOT_SIZE),
  },
  surface0: { borderColor: theme.colors.surface0 },
  surface1: { borderColor: theme.colors.surface1 },
  surface2: { borderColor: theme.colors.surface2 },
  surfaceSidebar: { borderColor: theme.colors.surfaceSidebar },
  surfaceSidebarHover: { borderColor: theme.colors.surfaceSidebarHover },
  surfaceSidebarSelected: { borderColor: theme.colors.surfaceSidebarSelected },
  statusAlertOverlay: {
    position: "absolute",
    right: STATUS_ALERT_OFFSET,
    bottom: STATUS_ALERT_OFFSET,
  },
  statusAlertKnockout: {
    borderRadius: theme.borderRadius.full,
  },
  statusDotFailed: {
    color: getStatusDotColor({ theme, bucket: "failed" }) ?? undefined,
  },
  statusDotAttention: {
    color: getStatusDotColor({ theme, bucket: "attention" }) ?? undefined,
  },
}));

// The outlined glyph is see-through, so it sits on a disc of the row's own background.
const knockoutStyles = StyleSheet.create((theme) => ({
  surface0: { backgroundColor: theme.colors.surface0 },
  surface1: { backgroundColor: theme.colors.surface1 },
  surface2: { backgroundColor: theme.colors.surface2 },
  surfaceSidebar: { backgroundColor: theme.colors.surfaceSidebar },
  surfaceSidebarHover: { backgroundColor: theme.colors.surfaceSidebarHover },
  surfaceSidebarSelected: { backgroundColor: theme.colors.surfaceSidebarSelected },
}));
