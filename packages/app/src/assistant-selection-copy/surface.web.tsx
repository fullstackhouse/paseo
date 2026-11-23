import {
  useCallback,
  useEffect,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Quote } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { getOverlayRoot, OVERLAY_Z } from "@/lib/overlay-root";
import { createAssistantSelectionClipboardContent } from "./content.web";

interface AssistantSelectionCopySurfaceProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Shows a Cite button next to a selection in an assistant message. */
  onCite?: (markdown: string) => void;
}

interface CiteAnchor {
  markdown: string;
  x: number;
  y: number;
}

const DISPLAY_CONTENTS: CSSProperties = { display: "contents" };
const CITE_BUTTON_WIDTH = 72;
const CITE_BUTTON_HEIGHT = 28;

/** The Cite button sits just after the selection's last line, kept on screen. */
function citeAnchorFromSelection(selection: Selection | null): CiteAnchor | null {
  const content = createAssistantSelectionClipboardContent(selection);
  if (!content || !selection) return null;
  const rects = selection.getRangeAt(0).getClientRects();
  const last = rects[rects.length - 1];
  if (!last) return null;
  const x = Math.min(last.right + 6, window.innerWidth - CITE_BUTTON_WIDTH - 8);
  const y = Math.max(8, last.top + last.height / 2 - CITE_BUTTON_HEIGHT / 2);
  return { markdown: content.plainText, x, y };
}

export function AssistantSelectionCopySurface({
  children,
  style,
  onCite,
}: AssistantSelectionCopySurfaceProps) {
  const [cite, setCite] = useState<CiteAnchor | null>(null);

  const handleCopy = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const content = createAssistantSelectionClipboardContent(window.getSelection());
    if (!content) {
      return;
    }

    event.preventDefault();
    event.clipboardData.setData("text/plain", content.plainText);
    event.clipboardData.setData("text/html", content.html);
  }, []);

  // A drag or Shift+arrow selection settles on mouseup/keyup. Reading it there avoids
  // converting the selection to markdown on every selectionchange.
  const handleSelectionSettled = useCallback(() => {
    if (!onCite) return;
    setCite(citeAnchorFromSelection(window.getSelection()));
  }, [onCite]);

  useEffect(() => {
    if (!cite) return;
    const hideWhenCleared = () => {
      if (window.getSelection()?.isCollapsed ?? true) setCite(null);
    };
    const hide = () => setCite(null);
    document.addEventListener("selectionchange", hideWhenCleared);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("selectionchange", hideWhenCleared);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [cite]);

  const handleCite = useCallback(() => {
    if (!cite || !onCite) return;
    onCite(cite.markdown);
    window.getSelection()?.removeAllRanges();
    setCite(null);
  }, [cite, onCite]);

  return (
    <div
      onCopy={handleCopy}
      onMouseUp={handleSelectionSettled}
      onKeyUp={handleSelectionSettled}
      style={DISPLAY_CONTENTS}
    >
      <View style={style}>{children}</View>
      {cite
        ? createPortal(<CiteButton anchor={cite} onPress={handleCite} />, getOverlayRoot())
        : null}
    </div>
  );
}

// Pressing must not collapse the selection before the click lands.
function keepSelection(event: { preventDefault: () => void }) {
  event.preventDefault();
}

function CiteButton({ anchor, onPress }: { anchor: CiteAnchor; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <View
      style={[styles.anchor, { left: anchor.x, top: anchor.y }]}
      // @ts-ignore - onMouseDown is web-only and not in RN types.
      onMouseDown={keepSelection}
    >
      <Button
        testID="assistant-selection-cite-button"
        variant="secondary"
        size="sm"
        leftIcon={Quote}
        onPress={onPress}
        style={styles.button}
      >
        {t("agentStream.cite")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  anchor: {
    position: "absolute",
    zIndex: OVERLAY_Z.tooltip,
    pointerEvents: "auto",
  },
  button: {
    height: CITE_BUTTON_HEIGHT,
    borderRadius: theme.borderRadius.full,
    ...theme.shadow.md,
  },
}));
