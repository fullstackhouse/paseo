import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GestureResponderEvent } from "react-native";
import {
  EnrichedMarkdownText,
  type LinkLongPressEvent,
  type LinkPressEvent,
} from "react-native-enriched-markdown";
import { withUnistyles } from "react-native-unistyles";
import {
  useAssistantFileLinkActions,
  useAssistantFileLinkEnvironment,
} from "@/assistant-file-links";
import { useStableEvent } from "@/hooks/use-stable-event";
import { matchCommandLink, useAgentCommandHints, type CommandHints } from "@/agent-commands";
import { useForgeShorthand } from "@/git/forge-shorthand";
import { pluginOverviewUrl } from "@getpaseo/protocol/plugin-overview";
import { openExternalUrl } from "@/utils/open-external-url";
import { AttachmentLightbox, type ImageLightboxSource } from "@/components/attachment-lightbox";
import type { Theme } from "@/styles/theme";
import { isWeb } from "@/constants/platform";
import { ContextMenu, useContextMenu } from "@/components/ui/context-menu";
import { usePluginLinkResolver, type ResolvedPluginLink } from "@/plugins/link-handlers";
import { PluginLinkMenu } from "./plugin-link-menu";
import { density, resolveDensity } from "@/styles/density";
import { MarkdownBlockStack } from "./block-stack";
import { WEB_RENDERERS } from "./renderers";
import { createMarkdownStyles } from "./styles";
import { PENDING_MARKDOWN_IMAGE } from "./source";
import { splitStreamingMarkdown } from "./streaming";
import { useMarkdownSource, type MarkdownImageContext } from "./images";

import { MermaidFence, MermaidStreamingContext, splitMermaidFences } from "./fence/mermaid";
import { MarkdownExternalContext } from "./external-context";

const ThemedMarkdown = withUnistyles(EnrichedMarkdownText);
const MD4C_FLAGS = { latexMath: false, hardSoftBreaks: true, admonitions: true };
// A README is written for its forge, where the lines of a paragraph join into one.
const EXTERNAL_MD4C_FLAGS = { ...MD4C_FLAGS, hardSoftBreaks: false };

// Reading the breakpoint here makes Unistyles restyle the text when the layout crosses it.
const markdownStyle =
  (compact: boolean, muted = false) =>
  (theme: Theme, rt: { breakpoint?: string }) =>
    createMarkdownStyles(theme, {
      compact,
      muted,
      blockGap: resolveDensity(rt, density.blockGap),
    });
const regularStyle = markdownStyle(false);
const compactStyle = markdownStyle(true);
const compactMutedStyle = markdownStyle(true, true);

function pickMarkdownStyle(compact: boolean, muted: boolean) {
  if (!compact) return regularStyle;
  return muted ? compactMutedStyle : compactStyle;
}

export interface MarkdownRendererProps extends MarkdownImageContext {
  text: string;
  compact?: boolean;
  /** Muted text colour. Compact surfaces only. */
  muted?: boolean;
  selectable?: boolean;
  streaming?: boolean;
  onLinkPress?: (url: string) => unknown;
  agentCommands?: boolean;
  /**
   * Author-controlled Markdown from outside this host, such as a plugin README: only its https
   * links and images work, nothing is read as a file, forge reference or command, and the lines of
   * a paragraph join as they do on its forge.
   */
  external?: boolean;
}

/** All Markdown surfaces share the same engine and source adaptation. */
export const MarkdownRenderer = memo(function MarkdownRenderer(props: MarkdownRendererProps) {
  const streaming = !isWeb && !!props.streaming;
  // Only completed lines affect block closure. Do not run mdast on every reveal frame.
  const completeLines = streaming ? props.text.slice(0, props.text.lastIndexOf("\n") + 1) : "";
  const boundary = useMemo(
    () => splitStreamingMarkdown(completeLines, true).head.length,
    [completeLines],
  );
  const Part = props.agentCommands ? CommandMarkdownPart : MarkdownPart;
  if (!streaming || boundary === 0) return <Part {...props} />;
  return (
    <MarkdownBlockStack>
      <Part {...props} text={props.text.slice(0, boundary)} />
      <Part {...props} text={props.text.slice(boundary)} />
    </MarkdownBlockStack>
  );
});

const CommandMarkdownPart = memo(function CommandMarkdownPart(props: MarkdownRendererProps) {
  const commandHints = useAgentCommandHints();
  return <MarkdownPart {...props} commandHints={commandHints} />;
});

const MarkdownPart = memo(function MarkdownPart({
  text,
  compact = false,
  muted = false,
  selectable = true,
  streaming = false,
  onLinkPress,
  agentCommands: _agentCommands,
  external = false,
  commandHints = null,
  ...imageContext
}: MarkdownRendererProps & { commandHints?: CommandHints | null }) {
  const environment = useAssistantFileLinkEnvironment();
  const actions = useAssistantFileLinkActions();
  const workspaceForgeShorthand = useForgeShorthand();
  const forgeShorthand = external ? null : workspaceForgeShorthand;
  const environmentClient = environment.client;
  const fallbackClient = useMemo(
    () =>
      environmentClient?.readFile
        ? { readFile: environmentClient.readFile.bind(environmentClient) }
        : undefined,
    [environmentClient],
  );
  const client = imageContext.client ?? fallbackClient;
  const { markdown, imageSources, linkRecognition, linkSource } = useMarkdownSource(
    text,
    {
      workspaceRoot: environment.workspaceRoot,
      serverId: environment.serverId,
      ...imageContext,
      client,
    },
    {
      commandNames: commandHints?.names,
      forgeReferencePattern: forgeShorthand?.pattern,
      external,
    },
  );
  const pluginLinks = usePluginLinkResolver(environment.serverId);
  const [image, setImage] = useState<ImageLightboxSource | null>(null);
  const pressLink = useStableEvent(({ url, sourceType }: LinkPressEvent) => {
    if (external) {
      // The parser still autolinks bare http, www and email text; only https links open.
      const safe = pluginOverviewUrl(url);
      if (safe) void openExternalUrl(safe);
      return;
    }
    const command = commandHints && matchCommandLink(url, sourceType, commandHints.names);
    if (command) {
      commandHints.insert(command);
      return;
    }
    const forgeUrl = sourceType === "text" ? forgeShorthand?.resolve(url) : null;
    const pluginLink = pluginLinks.resolve(forgeUrl ?? url);
    if (pluginLink) {
      pluginLink.open();
      return;
    }
    if (forgeUrl) {
      void openExternalUrl(forgeUrl);
      return;
    }
    const source = linkSource(url, sourceType);
    if (onLinkPress && !actions.canResolveFile(source)) onLinkPress(url);
    else actions.open(source, "preferred");
  });
  const pressImage = useStableEvent(({ url }: { url: string }) => {
    if (url !== PENDING_MARKDOWN_IMAGE) setImage({ type: "uri", uri: url });
  });
  const closeImage = useStableEvent(() => setImage(null));
  // Native long press: the link menu of a link a plugin opens. Web builds it into the anchor.
  const nativeLinkMenu = !isWeb && !external && pluginLinks.active;
  const touchPoint = useRef<TouchPoint | null>(null);
  const [menu, setMenu] = useState<{ link: ResolvedPluginLink; point: TouchPoint | null } | null>(
    null,
  );
  const recordTouch = useStableEvent((event: GestureResponderEvent) => {
    touchPoint.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
  });
  const longPressLink = useStableEvent(({ url }: LinkLongPressEvent) => {
    const link = pluginLinks.resolve(forgeShorthand?.resolve(url) ?? url);
    if (link) setMenu({ link, point: touchPoint.current });
  });
  const closeMenu = useStableEvent((open: boolean) => {
    if (!open) setMenu(null);
  });
  const segments = useMemo(
    () =>
      isWeb ? [{ kind: "markdown", id: "0", source: markdown }] : splitMermaidFences(markdown),
    [markdown],
  );
  return (
    <MarkdownExternalContext.Provider value={external}>
      <MermaidStreamingContext.Provider value={streaming}>
        <MarkdownBlockStack
          imageSources={imageSources}
          onTouchStart={nativeLinkMenu ? recordTouch : undefined}
        >
          {segments.map((segment) =>
            segment.kind === "mermaid" ? (
              <MermaidFence key={`${segment.kind}:${segment.id}`} code={segment.source} />
            ) : (
              <ThemedMarkdown
                key={`${segment.kind}:${segment.id}`}
                markdown={segment.source}
                uniProps={pickMarkdownStyle(compact, muted)}
                flavor="github"
                selectable={selectable}
                md4cFlags={external ? EXTERNAL_MD4C_FLAGS : MD4C_FLAGS}
                linkRecognition={linkRecognition}
                enableTaskListItemToggle={false}
                enableLinkPreview={false}
                enableBlockContextMenu={false}
                // JS reveal owns pacing; native fade animation is a separate experiment.
                streamingAnimation={false}
                onLinkPress={pressLink}
                onLinkLongPress={nativeLinkMenu ? longPressLink : undefined}
                onImagePress={pressImage}
                renderers={isWeb ? WEB_RENDERERS : undefined}
              />
            ),
          )}
        </MarkdownBlockStack>
        {image ? <AttachmentLightbox source={image} onClose={closeImage} /> : null}
        {menu ? (
          <ContextMenu open onOpenChange={closeMenu}>
            <MenuAnchor point={menu.point} />
            <PluginLinkMenu link={menu.link} />
          </ContextMenu>
        ) : null}
      </MermaidStreamingContext.Provider>
    </MarkdownExternalContext.Provider>
  );
});

interface TouchPoint {
  x: number;
  y: number;
}

/** Anchors a popover menu (wide layouts) at the long-pressed point. */
function MenuAnchor({ point }: { point: TouchPoint | null }) {
  const { setAnchorRect } = useContextMenu();
  useLayoutEffect(() => {
    if (point) setAnchorRect({ x: point.x, y: point.y, width: 0, height: 0 });
  }, [point, setAnchorRect]);
  return null;
}
