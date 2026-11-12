import type { PluginUpdateProposal } from "@getpaseo/protocol/messages";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
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

  const [failures, setFailures] = useState(new Map<string, string>());
  const apply = useMutation({
    mutationFn: async (proposals: PluginUpdateProposal[]) => {
      if (!client) throw new Error("Plugin host is offline");
      return client.applyPluginUpdates(proposals);
    },
    onSuccess: (results, proposals) => {
      setFailures((previous) => {
        const next = new Map(previous);
        for (const proposal of proposals) {
          const key = JSON.stringify(proposal);
          const result = results.find((candidate) => candidate.id === proposal.id);
          if (result?.outcome === "error") next.set(key, `${result.id}: ${result.error}`);
          else next.delete(key);
        }
        return next;
      });
    },
    onError: (error, proposals) => {
      setFailures((previous) => {
        const next = new Map(previous);
        for (const proposal of proposals)
          next.set(JSON.stringify(proposal), `${proposal.id}: ${errorMessage(error)}`);
        return next;
      });
    },
    onSettled: () => refetchPreview(),
  });
  const applyUpdates = apply.mutate;
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

  const applyError =
    selectPluginUpdateProposals(preview.data)
      .flatMap((proposal) => failures.get(JSON.stringify(proposal)) ?? [])
      .join("\n") || null;
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
  const dismiss = useStableEvent(() => setFailures(new Map()));

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
