import { Plus } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";

/** Shown while a workspace is being created, so a slow creation does not block the next one. */
export function StartAnotherButton({
  compact,
  onPress,
}: {
  compact: boolean;
  /** Null hides the button: nothing is being created. */
  onPress: (() => void) | null;
}) {
  const { t } = useTranslation();
  if (!onPress) return null;
  return (
    <View style={compact ? styles.compact : styles.wide}>
      <Button
        variant="ghost"
        leftIcon={Plus}
        onPress={onPress}
        style={styles.pill}
        testID="new-workspace-start-another"
      >
        {t("newWorkspace.startAnother")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Lines up with the composer's border, like the Import session pill.
  wide: {
    alignItems: "flex-start",
    paddingHorizontal: theme.spacing[4],
  },
  compact: {
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
  },
  pill: {
    borderRadius: theme.borderRadius.full,
    borderColor: theme.colors.borderAccent,
  },
}));
