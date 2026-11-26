import { useCallback, useMemo, type ReactElement } from "react";
import * as Clipboard from "expo-clipboard";
import { withUnistyles } from "react-native-unistyles";
import { AppWindow, Copy, Globe, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-api-context";
import { ContextMenuContent, ContextMenuItem, useContextMenu } from "@/components/ui/context-menu";
import { PluginIconView } from "@/plugins/icons";
import type { ResolvedPluginLink } from "@/plugins/link-handlers";
import { openExternalUrl } from "@/utils/open-external-url";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedPluginIcon = withUnistyles(PluginIconView);

/** Right-click or long-press menu of a link a plugin opens inside Paseo. Renders while open. */
export function PluginLinkMenu({ link }: { link: ResolvedPluginLink | null }): ReactElement | null {
  const { open } = useContextMenu();
  return open && link ? <PluginLinkMenuContent link={link} /> : null;
}

function PluginLinkMenuContent({ link }: { link: ResolvedPluginLink }): ReactElement {
  const { t } = useTranslation();
  const toast = useToast();
  const { url } = link;
  const openInBrowser = useCallback(() => void openExternalUrl(url), [url]);
  const copyLink = useCallback(() => {
    void Clipboard.setStringAsync(url).then(
      () => toast.copied(),
      (error: unknown) => toast.error(error instanceof Error ? error.message : String(error)),
    );
  }, [toast, url]);
  const pluginIcon = link.icon ?? AppWindow;
  const openLeading = useMemo(
    () => (
      <ThemedPluginIcon
        icon={pluginIcon}
        size={ICON_SIZE.sm}
        uniProps={foregroundMutedColorMapping}
      />
    ),
    [pluginIcon],
  );
  return (
    <ContextMenuContent align="start" width={220} testID="plugin-link-context-menu">
      <ContextMenuItem
        leading={openLeading}
        onSelect={link.open}
        testID="plugin-link-open-in-paseo"
      >
        {link.title}
      </ContextMenuItem>
      <PluginLinkMenuItem
        icon={Globe}
        label={t("linkActions.openInBrowser")}
        onSelect={openInBrowser}
        testID="plugin-link-open-in-browser"
      />
      <PluginLinkMenuItem
        icon={Copy}
        label={t("linkActions.copyLink")}
        onSelect={copyLink}
        testID="plugin-link-copy"
      />
    </ContextMenuContent>
  );
}

function PluginLinkMenuItem({
  icon,
  label,
  onSelect,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  testID: string;
}): ReactElement {
  const leading = useMemo(() => {
    const ThemedIcon = withUnistyles(icon);
    return <ThemedIcon size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />;
  }, [icon]);
  return (
    <ContextMenuItem leading={leading} onSelect={onSelect} testID={testID}>
      {label}
    </ContextMenuItem>
  );
}
