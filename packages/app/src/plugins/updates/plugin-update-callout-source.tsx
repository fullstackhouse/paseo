import type { PluginUpdateProposal } from "@getpaseo/protocol/messages";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import { useFetchQuery } from "@/data/query";
import { useStableEvent } from "@/hooks/use-stable-event";
import {
  resolvePluginUpdateCallout,
  selectPluginUpdateProposals,
} from "@/plugins/updates/resolve-plugin-update-callout";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Applies managed plugin updates automatically; only failures need a sidebar callout. */
export function PluginUpdateCalloutSource() {
  const hosts = useHosts();
  return hosts.map((host) => (
    <HostPluginUpdateCallout
      key={host.serverId}
      serverId={host.serverId}
      hostLabel={hosts.length > 1 ? host.label : null}
    />
  ));
}

function HostPluginUpdateCallout({
  serverId,
  hostLabel,
}: {
  serverId: string;
  hostLabel: string | null;
}) {
  const callouts = useSidebarCallouts();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const supported = useHostFeature(serverId, "pluginSourceUpdates");

  // Clients without daemon.manage get a permission error here; that host shows no callout.
  const preview = useFetchQuery({
    queryKey: ["plugin-update-preview", serverId],
    queryFn: async () => {
      if (!client) throw new Error("Plugin host is offline");
      return client.previewPluginUpdates();
    },
    enabled: Boolean(client && connected && supported),
    dataShape: "list",
    staleTimeMs: CHECK_INTERVAL_MS,
    refetchInterval: CHECK_INTERVAL_MS,
    retry: false,
  });
  const refetchPreview = preview.refetch;

  // Installs, updates and removals from the CLI or Settings change what's outdated; recheck
  // instead of waiting for the next interval.
  useEffect(() => {
    if (!client || !connected || !supported) return;
    const observation = client.observeEvents(["status.plugin_catalog_changed"]);
    observation.subscribe({
      snapshot: () => {},
      update: (message) => {
        if (message.type === "status" && message.payload.status === "plugin_catalog_changed")
          void refetchPreview();
      },
    });
    return () => {
      void observation
        .release()
        .catch((error) => console.warn("[Plugin updates] Failed to release catalog feed", error));
    };
  }, [client, connected, supported, refetchPreview]);

  const apply = useMutation({
    mutationFn: async (proposals: PluginUpdateProposal[]) => {
      if (!client) throw new Error("Plugin host is offline");
      const results = await client.applyPluginUpdates(proposals);
      const failures = results.filter((result) => result.outcome === "error");
      if (failures.length > 0) {
        throw new Error(failures.map((result) => `${result.id}: ${result.error}`).join("\n"));
      }
    },
    onSettled: () => refetchPreview(),
  });
  const applyUpdates = apply.mutate;
  const resetApply = apply.reset;
  const isApplying = apply.isPending;
  const attempted = useRef(new Set<string>());

  useEffect(() => {
    if (!client || !connected || !supported || isApplying) return;
    const proposals = selectPluginUpdateProposals(preview.data).filter(
      (proposal) => !attempted.current.has(JSON.stringify(proposal)),
    );
    if (proposals.length === 0) return;
    // Catalog events and the post-apply refresh can repeat a failed proposal. Only a
    // new target/installation or an explicit retry should attempt it again.
    for (const proposal of proposals) attempted.current.add(JSON.stringify(proposal));
    applyUpdates(proposals);
  }, [client, connected, supported, isApplying, preview.data, applyUpdates]);

  const applyError = apply.isError ? errorMessage(apply.error) : null;
  const descriptor = useMemo(
    () =>
      resolvePluginUpdateCallout({
        serverId,
        hostLabel,
        previews: preview.data,
        isApplying: apply.isPending,
        applyError,
      }),
    [serverId, hostLabel, preview.data, apply.isPending, applyError],
  );
  const update = useStableEvent(() => {
    if (descriptor) applyUpdates(descriptor.proposals);
  });
  const dismiss = useStableEvent(() => resetApply());

  useEffect(() => {
    if (!descriptor) return;
    return callouts.show({
      id: descriptor.id,
      dismissalKey: descriptor.dismissalKey,
      priority: 150,
      title: descriptor.title,
      description: descriptor.description,
      variant: descriptor.variant,
      actions: [
        {
          label: descriptor.actionLabel,
          onPress: update,
          variant: "primary",
          disabled: descriptor.actionDisabled,
        },
      ],
      onDismiss: dismiss,
      testID: "plugin-update-callout",
    });
  }, [callouts, descriptor, dismiss, update]);

  return null;
}
