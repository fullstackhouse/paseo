import type { PluginUpdatePreview, PluginUpdateProposal } from "@getpaseo/protocol/messages";
import { i18n } from "@/i18n/i18next";

export interface PluginUpdateCalloutDescriptor {
  id: string;
  dismissalKey: string;
  title: string;
  description: string;
  variant: "error";
  actionLabel: string;
  actionDisabled: boolean;
  proposals: PluginUpdateProposal[];
}

export interface ResolvePluginUpdateCalloutInput {
  serverId: string;
  /** Shown only when more than one host is configured. */
  hostLabel: string | null;
  previews: readonly PluginUpdatePreview[] | undefined;
  isApplying: boolean;
  applyError: string | null;
}

export function selectPluginUpdateProposals(
  previews: readonly PluginUpdatePreview[] | undefined,
): PluginUpdateProposal[] {
  return (previews ?? []).flatMap((preview) =>
    preview.outcome === "update" && preview.proposal ? [preview.proposal] : [],
  );
}

export function resolvePluginUpdateCallout(
  input: ResolvePluginUpdateCalloutInput,
): PluginUpdateCalloutDescriptor | null {
  const proposals = selectPluginUpdateProposals(input.previews);
  if (proposals.length === 0 || !input.applyError) return null;

  // Dismissing hides the callout until a plugin has a newer target than the dismissed one.
  const targets = proposals
    .map(({ id, target }) => `${id}@${target.kind === "git" ? target.commit : target.version}`)
    .join(",");
  const base = {
    id: `plugin-updates:${input.serverId}`,
    dismissalKey: `plugin-updates:${input.serverId}:${targets}`,
    actionDisabled: input.isApplying,
    proposals,
  };
  return {
    ...base,
    title: i18n.t("pluginUpdates.callout.failedTitle"),
    description: input.hostLabel ? `${input.hostLabel}: ${input.applyError}` : input.applyError,
    variant: "error",
    actionLabel: input.isApplying
      ? i18n.t("pluginUpdates.callout.updating")
      : i18n.t("common.actions.retry"),
  };
}
