import type { ReactNode } from "react";
import { View, type ViewProps } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { markdownCopyImageSourcesDataSet } from "@/assistant-selection-copy/markup";
import { isWeb } from "@/constants/platform";
import { density } from "@/styles/density";

/** Stacks Markdown blocks rendered as separate views with the same gap the text puts between its blocks. */
export function MarkdownBlockStack({
  imageSources,
  onTouchStart,
  children,
}: {
  imageSources?: Record<string, string>;
  onTouchStart?: ViewProps["onTouchStart"];
  children: ReactNode;
}) {
  return (
    <View
      style={styles.stack}
      onTouchStart={onTouchStart}
      dataSet={isWeb && imageSources ? markdownCopyImageSourcesDataSet(imageSources) : undefined}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: density.blockGap },
});
