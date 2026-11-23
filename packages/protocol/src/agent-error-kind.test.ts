import { describe, expect, it } from "vitest";
import { classifyAgentError } from "./agent-error-kind.js";

describe("classifyAgentError", () => {
  it.each([
    "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)",
    "API Error: Connection error.",
    "getaddrinfo EAI_AGAIN api.anthropic.com",
    "read ECONNRESET",
    "TypeError: fetch failed",
    "stream disconnected before completion: error sending request",
    'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    "API Error: 500 Internal server error",
    "Request timed out.",
  ])("treats %j as transient", (message) => {
    expect(classifyAgentError(message)).toBe("transient");
  });

  it.each([
    "You've hit your limit · resets 5pm (Europe/Warsaw)",
    "Claude AI usage limit reached|1764000000",
    'API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}',
    "Credit balance is too low",
  ])("treats %j as a usage limit", (message) => {
    expect(classifyAgentError(message)).toBe("usage_limit");
  });

  it.each([null, undefined, "", "Tool permission denied", "Invalid model: foo"])(
    "treats %j as other",
    (message) => {
      expect(classifyAgentError(message)).toBe("other");
    },
  );
});
