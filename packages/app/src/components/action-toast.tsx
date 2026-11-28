import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";

/** A toast's message with one button after it, such as Undo. */
export function ActionToast({
  message,
  actionLabel,
  onAction,
  actionTrailing,
  actionTestID,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
  actionTrailing?: ReactNode;
  actionTestID?: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.message}>{message}</Text>
      <Button size="sm" onPress={onAction} testID={actionTestID} trailing={actionTrailing}>
        {actionLabel}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  message: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
}));
