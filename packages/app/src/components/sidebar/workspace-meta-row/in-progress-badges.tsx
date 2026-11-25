import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type StyleProp, type TextStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { CircleAlert, CircleDashed, Eye } from "lucide-react-native";
import { HOST_BADGE_ICON_SIZE } from "@/hosts/host-badge";
import type { Theme } from "@/styles/theme";
import type { InProgressBadge } from "./in-progress-items";

const ThemedCircleAlert = withUnistyles(CircleAlert);
const ThemedCircleDashed = withUnistyles(CircleDashed);
const ThemedEye = withUnistyles(Eye);

const warningMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** The badges on the meta line, after the row's own items and before plugin items. */
export function InProgressBadges({
  badges,
  separated,
  separatorStyle,
}: {
  badges: readonly InProgressBadge[];
  /** Something is drawn before the first badge on the line. */
  separated: boolean;
  /** The meta line's separator style, which follows the row's backdrop. */
  separatorStyle: StyleProp<TextStyle>;
}) {
  return badges.map((badge, index) => (
    <Fragment key={badge.kind}>
      {separated || index > 0 ? <Text style={separatorStyle}>·</Text> : null}
      <InProgressBadgeItem badge={badge} />
    </Fragment>
  ));
}

function InProgressBadgeItem({ badge }: { badge: InProgressBadge }) {
  const { t } = useTranslation();
  if (badge.kind === "notMoving") {
    return (
      <View style={styles.item} testID="sidebar-workspace-not-moving">
        <ThemedCircleAlert size={HOST_BADGE_ICON_SIZE} uniProps={warningMapping} />
        <Text style={styles.warningText} numberOfLines={1}>
          {t("sidebar.inProgress.notMoving", { count: badge.count })}
        </Text>
      </View>
    );
  }
  if (badge.kind === "inProgress") {
    return (
      <View style={styles.item} testID="sidebar-workspace-in-progress">
        <ThemedCircleDashed size={HOST_BADGE_ICON_SIZE} uniProps={mutedMapping} />
        <Text style={styles.mutedText} numberOfLines={1}>
          {t("sidebar.inProgress.inProgress", { count: badge.count })}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.item} testID="sidebar-workspace-awaiting-review">
      <ThemedEye size={HOST_BADGE_ICON_SIZE} uniProps={mutedMapping} />
      <Text style={styles.mutedText} numberOfLines={1}>
        {badge.count > 1
          ? t("sidebar.inProgress.awaitingReviewCount", { count: badge.count })
          : t("sidebar.inProgress.awaitingReview")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Short counts that explain the row's group, so they keep their width; the branch, project and
  // labels give way first.
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    flexShrink: 0,
  },
  warningText: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
}));
