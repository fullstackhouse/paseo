import { useCallback } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  BROWSER_LIVE_KEYS,
  type BrowserLiveInput,
  type BrowserLiveKey,
} from "@getpaseo/protocol/browser-automation/live-view";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { BrowserControlAvailability, BrowserControlState } from "./control";
import { SecretTextInput } from "./secret-text-input";

const KEY_LABELS: Record<BrowserLiveKey, { glyph?: string; label: string }> = {
  Enter: { label: "workspace.browser.liveView.keys.enter" },
  Tab: { label: "workspace.browser.liveView.keys.tab" },
  Backspace: { label: "workspace.browser.liveView.keys.backspace" },
  Escape: { label: "workspace.browser.liveView.keys.escape" },
  ArrowUp: { glyph: "↑", label: "workspace.browser.liveView.keys.arrowUp" },
  ArrowDown: { glyph: "↓", label: "workspace.browser.liveView.keys.arrowDown" },
  ArrowLeft: { glyph: "←", label: "workspace.browser.liveView.keys.arrowLeft" },
  ArrowRight: { glyph: "→", label: "workspace.browser.liveView.keys.arrowRight" },
};

const NOTICE_KEYS: Record<string, string> = {
  released: "workspace.browser.liveView.notices.released",
  connection: "workspace.browser.liveView.notices.connection",
  target_changed: "workspace.browser.liveView.notices.targetChanged",
  page_changed: "workspace.browser.liveView.notices.pageChanged",
  does_not_fit: "workspace.browser.liveView.notices.doesNotFit",
  stream_ended: "workspace.browser.liveView.notices.streamEnded",
  not_sent: "workspace.browser.liveView.notices.notSent",
  page_blocked: "workspace.browser.liveView.notices.pageBlocked",
  unload_blocked: "workspace.browser.liveView.notices.unloadBlocked",
  reloaded: "workspace.browser.liveView.notices.reloaded",
  unconfirmed: "workspace.browser.liveView.notices.unconfirmed",
  agent_busy: "workspace.browser.liveView.notices.agentBusy",
  busy: "workspace.browser.liveView.notices.busy",
  key_unsupported: "workspace.browser.liveView.notices.keyUnsupported",
  disabled: "workspace.browser.liveView.notices.disabled",
  update_desktop: "workspace.browser.liveView.control.updateDesktop",
};

interface ControlPanelProps {
  state: BrowserControlState;
  availability: BrowserControlAvailability;
  /** False until a frame is on screen, so nobody controls a page they can't see. */
  canTakeControl: boolean;
  /** A dialog or a busy script holds the page up. Watching doesn't touch it. */
  pageBlocked: boolean;
  onTake: () => void;
  onHandBack: () => void;
  onSend: (input: BrowserLiveInput) => void;
}

/** Below the live view: where the page is, who controls it, and where typed text goes. */
export function ControlPanel(props: ControlPanelProps) {
  const { state, availability, canTakeControl, pageBlocked, onTake } = props;
  const { t } = useTranslation();
  const { origin, held, notice, busy, connected } = state;
  if (availability === "unknown" && !held) return null;
  let noticeKey: string | null = null;
  if (notice) noticeKey = NOTICE_KEYS[notice] ?? "workspace.browser.liveView.notices.failed";
  else if (pageBlocked && !held) noticeKey = "workspace.browser.liveView.notices.watchBlocked";

  return (
    <View style={styles.panel} testID="browser-live-control">
      {noticeKey ? (
        <Alert
          variant="warning"
          size="sm"
          description={t(noticeKey)}
          testID="browser-live-notice"
        />
      ) : null}
      {origin ? (
        <Text style={styles.origin} testID="browser-live-page-origin">
          {t("workspace.browser.liveView.control.pageOrigin", { origin: formatOrigin(origin, t) })}
        </Text>
      ) : null}
      {held ? <HeldControls {...props} /> : null}
      {!held && availability === "update_host" ? (
        <Text style={styles.hint} testID="browser-live-update-host">
          {t("workspace.browser.liveView.control.updateHost")}
        </Text>
      ) : null}
      {!held && availability === "update_desktop" ? (
        <Text style={styles.hint} testID="browser-live-update-desktop">
          {t("workspace.browser.liveView.control.updateDesktop")}
        </Text>
      ) : null}
      {!held && availability === "ready" ? (
        <>
          <Text style={styles.hint}>{t("workspace.browser.liveView.control.takeHint")}</Text>
          <Button
            variant="default"
            disabled={!connected || !canTakeControl}
            loading={busy === "taking"}
            onPress={onTake}
            testID="browser-live-take-control"
          >
            {t(
              busy === "taking"
                ? "workspace.browser.liveView.control.taking"
                : "workspace.browser.liveView.control.take",
            )}
          </Button>
        </>
      ) : null}
    </View>
  );
}

function HeldControls({ state, onHandBack, onSend }: ControlPanelProps) {
  const { t } = useTranslation();
  const { focus, busy, connected } = state;
  const canSend = connected && busy === null;
  const targetId = focus?.targetId;
  const submitText = useCallback(
    (text: string) => {
      if (targetId) onSend({ kind: "insert_text", targetId, text });
    },
    [onSend, targetId],
  );
  const embedded = focus !== null && focus.origin !== focus.topOrigin;

  return (
    <>
      {focus ? (
        <>
          <View>
            <Text style={styles.target} testID="browser-live-target-origin">
              {t("workspace.browser.liveView.control.typingInto", {
                origin: formatOrigin(focus.origin, t),
              })}
            </Text>
            {embedded ? (
              <Text style={styles.origin} testID="browser-live-top-origin">
                {t("workspace.browser.liveView.control.embeddedIn", {
                  origin: formatOrigin(focus.topOrigin, t),
                })}
              </Text>
            ) : null}
          </View>
          <SecretTextInput
            key={`${focus.origin} ${focus.targetId}`}
            focus={focus}
            canSend={canSend}
            onSubmit={submitText}
          />
        </>
      ) : (
        <>
          <Text style={styles.hint}>{t("workspace.browser.liveView.control.heldHint")}</Text>
          <Text style={styles.hint}>{t("workspace.browser.liveView.control.handBackHint")}</Text>
        </>
      )}
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.keys}
      >
        {BROWSER_LIVE_KEYS.map((key) => (
          <KeyButton key={key} browserKey={key} disabled={!canSend} onSend={onSend} />
        ))}
      </ScrollView>
      <Button
        disabled={!canSend}
        loading={busy === "releasing"}
        onPress={onHandBack}
        testID="browser-live-hand-back"
      >
        {t(
          busy === "releasing"
            ? "workspace.browser.liveView.control.handingBack"
            : "workspace.browser.liveView.control.handBack",
        )}
      </Button>
    </>
  );
}

function KeyButton(props: {
  browserKey: BrowserLiveKey;
  disabled: boolean;
  onSend: (input: BrowserLiveInput) => void;
}) {
  const { browserKey, disabled, onSend } = props;
  const { t } = useTranslation();
  const { glyph, label } = KEY_LABELS[browserKey];
  const press = useCallback(() => onSend({ kind: "key", key: browserKey }), [browserKey, onSend]);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      onPress={press}
      accessibilityLabel={t(label)}
      testID={`browser-live-key-${browserKey}`}
    >
      {glyph ?? t(label)}
    </Button>
  );
}

// Opaque origins, as of a sandboxed frame, serialize as "null".
function formatOrigin(origin: string, t: (key: string) => string): string {
  return origin === "null" ? t("workspace.browser.liveView.control.unknownOrigin") : origin;
}

const styles = StyleSheet.create((theme) => ({
  panel: {
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  origin: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  target: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  keys: {
    gap: theme.spacing[2],
  },
}));
