import { useEffect, useMemo, useState } from "react";
import { Image, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { CheckoutDiffImageSide } from "@getpaseo/protocol/messages";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { checkoutDiffImageQueryKey } from "./query-keys";
import type { DiffImagePreviewSource } from "./diff-document/types";

/** Height the diff document reserves for a before/after image preview row. */
export const DIFF_IMAGE_PREVIEW_HEIGHT = 320;

const IMAGE_STALE_TIME_MS = 30_000;

interface DiffImagePreviewProps {
  preview: DiffImagePreviewSource;
  path: string;
  oldPath?: string;
}

/** GitHub-style 2-up view of a changed image: before on the left, after on the right. */
export function DiffImagePreview({ preview, path, oldPath }: DiffImagePreviewProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(preview.serverId);
  const isConnected = useHostRuntimeIsConnected(preview.serverId);
  const query = useFetchQuery({
    queryKey: checkoutDiffImageQueryKey(
      preview.serverId,
      preview.cwd,
      JSON.stringify(preview.source),
      path,
      oldPath,
    ),
    queryFn: () => {
      if (!client) throw new Error("Host disconnected");
      return client.getCheckoutDiffImage({
        cwd: preview.cwd,
        path,
        oldPath,
        source: preview.source,
      });
    },
    enabled: Boolean(client) && isConnected,
    dataShape: "value",
    staleTimeMs: IMAGE_STALE_TIME_MS,
    // Image bytes are large; drop them soon after the row scrolls away.
    gcTime: IMAGE_STALE_TIME_MS,
  });

  if (query.error) {
    return <Message text={t("workspace.git.diff.image.loadFailed")} />;
  }
  if (!query.data) {
    return <Message text={t("workspace.git.diff.image.loading")} />;
  }
  const { old: before, new: after } = query.data;
  return (
    <View style={styles.container}>
      {before.status === "missing" ? null : (
        <ImageSide label={t("workspace.git.diff.image.before")} side={before} />
      )}
      {after.status === "missing" ? null : (
        <ImageSide label={t("workspace.git.diff.image.after")} side={after} />
      )}
    </View>
  );
}

type PresentImageSide = Exclude<CheckoutDiffImageSide, { status: "missing" }>;

function ImageSide({ label, side }: { label: string; side: PresentImageSide }) {
  const { t } = useTranslation();
  const source = useMemo(
    () =>
      side.status === "ok" ? { uri: `data:${side.mimeType};base64,${side.content}` } : undefined,
    [side],
  );
  return (
    <View style={styles.side}>
      <Text style={styles.label} numberOfLines={1}>
        {`${label} · ${formatBytes(side.size)}`}
      </Text>
      <View style={styles.frame}>
        {source ? (
          <SizedImage source={source} />
        ) : (
          <Text style={styles.message}>{t("workspace.git.diff.image.tooLarge")}</Text>
        )}
      </View>
    </View>
  );
}

/** Shows the image at its natural size, scaled down (never up) to fit the frame. */
function SizedImage({ source }: { source: { uri: string } }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    let active = true;
    Image.getSize(
      source.uri,
      (width, height) => {
        if (active && width > 0 && height > 0) setSize({ width, height });
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [source.uri]);
  const image = <Image source={source} style={styles.image} resizeMode="contain" />;
  if (!size) return image;
  return <View style={styles.naturalBox(size.width, size.height)}>{image}</View>;
}

function Message({ text }: { text: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{text}</Text>
    </View>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
  },
  side: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  label: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  frame: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  naturalBox: (width: number, height: number) => ({
    width,
    height,
    maxWidth: "100%",
    maxHeight: "100%",
  }),

  message: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
