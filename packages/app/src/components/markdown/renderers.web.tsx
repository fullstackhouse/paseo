import { Text } from "react-native";
import {
  forwardRef,
  useCallback,
  useMemo,
  useState,
  type ComponentProps,
  type MouseEvent,
  useContext,
} from "react";
import type {
  CodeBlockRendererProps,
  LinkRendererProps,
  MarkdownRenderers,
} from "react-native-enriched-markdown";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  canOpenFileLinkWithDefaultApp,
  useAssistantFileLinkEnvironment,
  useFileLink,
  useOpenFileLinkWithDefaultApp,
} from "@/assistant-file-links";
import { ContextMenu, useContextMenu } from "@/components/ui/context-menu";
import { MARKDOWN_COPY_RECOGNIZED_LINK_ATTRIBUTE } from "@/assistant-selection-copy/markup";
import { useForgeShorthand } from "@/git/forge-shorthand";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { hasDesktopOpenTargetsBridge } from "@/workspace/desktop-open-targets";
import type { Theme } from "@/styles/theme";
import { usePluginLinkResolver } from "@/plugins/link-handlers";
import { FileLinkMenu } from "./file-link-menu";
import { PluginLinkMenu } from "./plugin-link-menu";
import { MermaidFence } from "./fence/mermaid";
import { MarkdownExternalContext } from "./external-context";
import { isRecognizedLink, markdownLinkSource } from "./source";

const ThemedCodeBlock = withUnistyles(HighlightedCodeBlock);
const codeStyle = (theme: Theme) => ({
  inheritedStyles: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
  },
  textStyle: { backgroundColor: theme.colors.surface2, padding: 12, borderRadius: 8 },
});
function WebCodeBlock({ code, language }: CodeBlockRendererProps) {
  if (language?.toLowerCase() === "mermaid") return <MermaidFence code={code} />;
  return <ThemedCodeBlock code={code} language={language} uniProps={codeStyle} />;
}

// The library styles links inline, so a stylesheet :hover rule cannot underline them.
const LINK_HOVER_STYLE = { textDecoration: "underline" } as const;

function WebLink(props: LinkRendererProps) {
  const forgeShorthand = useForgeShorthand();
  // A forge reference like `#12` carries its web URL so hover, copy and new-tab opens work.
  const forgeUrl =
    props.link.sourceType === "text" ? (forgeShorthand?.resolve(props.link.url) ?? null) : null;
  const fileLink = useFileLink(
    forgeUrl
      ? markdownLinkSource(forgeUrl)
      : markdownLinkSource(props.link.url, props.link.sourceType),
  );
  const environment = useAssistantFileLinkEnvironment();
  const isLocalDaemon = useIsLocalDaemon(environment.serverId ?? "");
  const pluginLinks = usePluginLinkResolver(environment.serverId);
  const external = useContext(MarkdownExternalContext);
  // Only a link a plugin opens gets this menu; other web links keep the browser's own.
  const pluginLink =
    pluginLinks.active && !external && !fileLink.isFileLink
      ? pluginLinks.resolve(forgeUrl ?? props.link.url)
      : null;
  if (pluginLink) {
    return (
      <ContextMenu>
        <ContextMenuLinkAnchor {...props} fileLink={fileLink} forgeUrl={forgeUrl} />
        <PluginLinkMenu link={pluginLink} />
      </ContextMenu>
    );
  }
  if (!fileLink.isFileLink || !isLocalDaemon || !environment.serverId) {
    return <WebLinkAnchor {...props} fileLink={fileLink} forgeUrl={forgeUrl} />;
  }
  return (
    <ContextMenu>
      <DesktopFileLinkAnchor {...props} fileLink={fileLink} forgeUrl={forgeUrl} />
      <FileLinkMenu
        serverId={environment.serverId}
        workspaceRoot={environment.workspaceRoot}
        resolve={fileLink.resolve}
      />
    </ContextMenu>
  );
}

type WebLinkAnchorProps = LinkRendererProps & {
  fileLink: ReturnType<typeof useFileLink>;
  forgeUrl: string | null;
};

// Right click opens the file menu; Cmd/Ctrl+click opens the file in its default app.
function DesktopFileLinkAnchor({ anchorProps, fileLink, ...props }: WebLinkAnchorProps) {
  const menu = useContextMenu();
  const openWithDefaultApp = useOpenFileLinkWithDefaultApp();
  const { onClick } = anchorProps;
  const { resolve } = fileLink;
  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!(event.metaKey || event.ctrlKey) || !canOpenFileLinkWithDefaultApp()) {
        onClick?.(event);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        const target = await resolve();
        if (target) openWithDefaultApp(target);
      })();
    },
    [onClick, openWithDefaultApp, resolve],
  );
  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (!hasDesktopOpenTargetsBridge()) return;
      event.preventDefault();
      event.stopPropagation();
      menu.setAnchorRect({ x: event.pageX, y: event.pageY, width: 0, height: 0 });
      menu.setOpen(true);
    },
    [menu],
  );
  const desktopAnchorProps = useMemo(
    () => ({ ...anchorProps, onClick: handleClick, onContextMenu: handleContextMenu }),
    [anchorProps, handleClick, handleContextMenu],
  );
  return <WebLinkAnchor {...props} anchorProps={desktopAnchorProps} fileLink={fileLink} />;
}

// Right click opens the link menu of a link a plugin opens inside Paseo.
function ContextMenuLinkAnchor({ anchorProps, ...props }: WebLinkAnchorProps) {
  const menu = useContextMenu();
  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      event.stopPropagation();
      menu.setAnchorRect({ x: event.pageX, y: event.pageY, width: 0, height: 0 });
      menu.setOpen(true);
    },
    [menu],
  );
  const menuAnchorProps = useMemo(
    () => ({ ...anchorProps, onContextMenu: handleContextMenu }),
    [anchorProps, handleContextMenu],
  );
  return <WebLinkAnchor {...props} anchorProps={menuAnchorProps} />;
}

function WebLinkAnchor({ link, anchorProps, children, fileLink, forgeUrl }: WebLinkAnchorProps) {
  const { tooltipPath, onHoverIn } = fileLink;
  const tooltip = forgeUrl ?? tooltipPath;
  const [hovered, setHovered] = useState(false);
  const handleMouseEnter = useCallback(() => setHovered(true), []);
  const handleMouseLeave = useCallback(() => setHovered(false), []);
  const anchorStyle = useMemo(
    () => ({
      ...anchorProps.style,
      overflowWrap: "anywhere" as const,
      ...(hovered ? LINK_HOVER_STYLE : null),
    }),
    [anchorProps.style, hovered],
  );
  // Selection copy pastes a link Paseo recognized as the text the reply showed.
  const recognized = isRecognizedLink(link);
  const copyAnchorProps = useMemo(
    () =>
      recognized
        ? { ...anchorProps, [MARKDOWN_COPY_RECOGNIZED_LINK_ATTRIBUTE]: "true" }
        : anchorProps,
    [anchorProps, recognized],
  );
  const anchor = (
    <a
      {...copyAnchorProps}
      href={forgeUrl ?? anchorProps.href}
      style={anchorStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </a>
  );
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild onHoverIn={onHoverIn}>
        <InlineLinkTrigger>{anchor}</InlineLinkTrigger>
      </TooltipTrigger>
      {tooltip ? (
        <TooltipContent side="top" align="start" maxWidth={520}>
          <Text selectable={false} style={styles.tooltipPath}>
            {tooltip}
          </Text>
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}
// TooltipTrigger also supplies native Pressable handlers; forward only DOM events.
// A View renders a div, which is invalid inside the library's prose paragraphs.
const InlineLinkTrigger = forwardRef<HTMLSpanElement, ComponentProps<"span">>(
  function InlineLinkTrigger({ children, onMouseEnter, onMouseLeave, onFocus, onBlur }, ref) {
    return (
      <span
        ref={ref}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        {children}
      </span>
    );
  },
);
const styles = StyleSheet.create((theme) => ({
  tooltipPath: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
}));

export const WEB_RENDERERS: MarkdownRenderers = { codeBlock: WebCodeBlock, link: WebLink };
