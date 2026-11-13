import { useCallback, useMemo, useState } from "react";
import {
  checkPluginUpdates,
  describePluginUpdateCheck,
  type PluginUpdateHost,
} from "@/plugins/updates/check-plugin-updates";
import { useHostFeatureMap } from "@/runtime/host-features";
import {
  getHostRuntimeStore,
  useHostRuntimeConnectionStatuses,
  useHosts,
} from "@/runtime/host-runtime";

export interface PluginUpdateCheck {
  /** A connected host can apply plugin updates. */
  available: boolean;
  checking: boolean;
  /** Applies every available update on connected hosts; resolves to a message for the user. */
  check(): Promise<ReturnType<typeof describePluginUpdateCheck>>;
}

export function usePluginUpdateCheck(): PluginUpdateCheck {
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  // COMPAT(pluginSourceUpdates): added in v0.8.0; remove gate after 2027-03-16 once daemon floor supports reviewed updates.
  const supported = useHostFeatureMap(serverIds, "pluginSourceUpdates");
  const statuses = useHostRuntimeConnectionStatuses(serverIds);
  const ready = useMemo(
    () =>
      hosts.filter(
        (host) => supported.get(host.serverId) === true && statuses.get(host.serverId) === "online",
      ),
    [hosts, statuses, supported],
  );
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    const store = getHostRuntimeStore();
    const targets = ready.flatMap((host): PluginUpdateHost[] => {
      const client = store.getClient(host.serverId);
      return client ? [{ label: ready.length > 1 ? host.label : null, client }] : [];
    });
    setChecking(true);
    try {
      return describePluginUpdateCheck(await checkPluginUpdates(targets));
    } finally {
      setChecking(false);
    }
  }, [ready]);

  return { available: ready.length > 0, checking, check };
}
