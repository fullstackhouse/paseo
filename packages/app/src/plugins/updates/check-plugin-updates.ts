import type {
  PluginUpdatePreview,
  PluginUpdateProposal,
  PluginUpdateResult,
} from "@getpaseo/protocol/messages";
import { i18n } from "@/i18n/i18next";
import { selectPluginUpdateProposals } from "@/plugins/updates/resolve-plugin-update-callout";

export interface PluginUpdateClient {
  previewPluginUpdates(): Promise<PluginUpdatePreview[]>;
  applyPluginUpdates(proposals: PluginUpdateProposal[]): Promise<PluginUpdateResult[]>;
}

export interface PluginUpdateHost {
  /** Prefixes this host's plugin ids; pass null when only one host is checked. */
  label: string | null;
  client: PluginUpdateClient;
}

export interface PluginUpdateCheckResult {
  updated: string[];
  failures: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function checkHost({ label, client }: PluginUpdateHost): Promise<PluginUpdateCheckResult> {
  const name = (id: string) => (label ? `${label}: ${id}` : id);
  try {
    const previews = await client.previewPluginUpdates();
    const failures = previews.flatMap((preview) =>
      preview.outcome === "error"
        ? [`${name(preview.id)}: ${preview.error ?? "unknown error"}`]
        : [],
    );
    const proposals = selectPluginUpdateProposals(previews);
    if (proposals.length === 0) return { updated: [], failures };
    const updated: string[] = [];
    for (const result of await client.applyPluginUpdates(proposals)) {
      if (result.outcome === "updated") updated.push(name(result.id));
      else failures.push(`${name(result.id)}: ${result.error ?? "unknown error"}`);
    }
    return { updated, failures };
  } catch (error) {
    return {
      updated: [],
      failures: [label ? `${label}: ${errorMessage(error)}` : errorMessage(error)],
    };
  }
}

/** Applies every available plugin update on each host, like `paseo plugin update --all --yes`. */
export async function checkPluginUpdates(
  hosts: readonly PluginUpdateHost[],
): Promise<PluginUpdateCheckResult> {
  const results = await Promise.all(hosts.map(checkHost));
  return {
    updated: results.flatMap((result) => result.updated),
    failures: results.flatMap((result) => result.failures),
  };
}

export function describePluginUpdateCheck(result: PluginUpdateCheckResult): {
  kind: "success" | "error";
  message: string;
} {
  const lines: string[] = [];
  if (result.updated.length > 0)
    lines.push(i18n.t("pluginUpdates.check.updated", { plugins: result.updated.join(", ") }));
  if (result.failures.length > 0)
    lines.push(i18n.t("pluginUpdates.check.failed", { errors: result.failures.join("\n") }));
  if (lines.length === 0) lines.push(i18n.t("pluginUpdates.check.upToDate"));
  return { kind: result.failures.length > 0 ? "error" : "success", message: lines.join("\n") };
}
