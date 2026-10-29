import { useEffect, useRef } from "react";
import {
  IDLE_INSTALL_QUIET_MS,
  createIdleInstallTrigger,
  summarizeLocalHostActivity,
  type IdleInstallTrigger,
} from "@/desktop/updates/install-when-idle";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useSessionStore } from "@/stores/session-store";

/** While `enabled`, calls `onIdle` once the local host has had no agent work for the quiet window. */
export function useInstallWhenIdle({
  enabled,
  onIdle,
}: {
  enabled: boolean;
  onIdle: () => void;
}): void {
  const localServerId = useLocalDaemonServerId();
  const activity = useSessionStore((state) =>
    summarizeLocalHostActivity(localServerId ? state.sessions[localServerId] : null),
  );
  const fire = useStableEvent(onIdle);
  const triggerRef = useRef<IdleInstallTrigger | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const trigger = createIdleInstallTrigger({ quietMs: IDLE_INSTALL_QUIET_MS, onIdle: fire });
    triggerRef.current = trigger;
    return () => {
      trigger.dispose();
      triggerRef.current = null;
    };
  }, [enabled, fire]);

  useEffect(() => {
    triggerRef.current?.update(activity);
  }, [activity, enabled]);
}
