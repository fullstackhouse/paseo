import type {
  BrowserAutomationErrorCode,
  BrowserAutomationExecuteResponse,
} from "@getpaseo/protocol/browser-automation/rpc-schemas";

export type BrowserToolsResponsePayload = BrowserAutomationExecuteResponse["payload"];
export type BrowserToolsErrorPayload = Extract<BrowserToolsResponsePayload, { ok: false }>["error"];

/**
 * What a tool caller gets. browser_human_control is made here and stops here: it isn't in the wire
 * enum, because older peers reject codes they don't know.
 */
export type BrowserToolsCallPayload = (
  | BrowserToolsResponsePayload
  | {
      requestId: string;
      ok: false;
      error: { code: "browser_human_control"; message: string; retryable: boolean };
      dialogs?: Extract<BrowserToolsResponsePayload, { ok: false }>["dialogs"];
    }
) & {
  /** What the user did with the tab since this agent's last browser call. */
  userNotes?: string[];
};

export class BrowserToolsRequestError extends Error {
  public readonly code: BrowserAutomationErrorCode;
  public readonly retryable: boolean;

  public constructor(error: BrowserToolsErrorPayload) {
    super(error.message);
    this.name = "BrowserToolsRequestError";
    this.code = error.code;
    this.retryable = error.retryable;
  }
}

export function browserToolsFailure(params: {
  requestId: string;
  code: BrowserAutomationErrorCode;
  message: string;
  retryable?: boolean;
}): BrowserToolsResponsePayload {
  return {
    requestId: params.requestId,
    ok: false,
    error: {
      code: params.code,
      message: params.message,
      retryable: params.retryable ?? false,
    },
  };
}

export function createBrowserToolsRequestError(params: {
  code: BrowserAutomationErrorCode;
  message: string;
  retryable?: boolean;
}): BrowserToolsRequestError {
  return new BrowserToolsRequestError({
    code: params.code,
    message: params.message,
    retryable: params.retryable ?? false,
  });
}

export function browserHumanControlFailure(requestId: string): BrowserToolsCallPayload {
  return {
    requestId,
    ok: false,
    error: {
      code: "browser_human_control",
      message: "The user is controlling this tab. Wait for hand-back, then call browser_snapshot.",
      retryable: true,
    },
  };
}
