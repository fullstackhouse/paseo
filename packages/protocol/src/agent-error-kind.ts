// FSH fork: sorts a failed turn's error text so clients can offer a retry. Turn failures carry only
// the provider's message (`lastError`), so this matches the wording Claude Code, Codex and Node use.
export type AgentErrorKind = "transient" | "usage_limit" | "other";

// Checked first: a usage limit or 429 won't clear by retrying now, even when it mentions the API.
const USAGE_LIMIT_PATTERN =
  /usage limit|hit your (?:usage )?limit|rate[ _-]?limit|too many requests|\b429\b|quota exceeded|insufficient_quota|credit balance is too low/i;

// The network dropped, DNS failed, or the provider's API was briefly down or overloaded.
const TRANSIENT_PATTERN =
  /\b(?:ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ENETUNREACH|ENETDOWN|EHOSTUNREACH|EPIPE)\b|can'?t reach the api|connection error|network error|fetch failed|socket hang up|stream disconnected|error sending request|request timed out|timed out|overloaded|service unavailable|bad gateway|gateway timeout|internal server error|\b(?:500|502|503|504|529)\b/i;

export function classifyAgentError(message: string | null | undefined): AgentErrorKind {
  if (!message) return "other";
  if (USAGE_LIMIT_PATTERN.test(message)) return "usage_limit";
  if (TRANSIENT_PATTERN.test(message)) return "transient";
  return "other";
}
