export {
  classifyAssistantFileLink,
  normalizeInlinePathTarget,
  type InlinePathTarget,
} from "./parse";
export {
  AssistantFileLinkResolverProvider,
  useAssistantFileLinkEnvironment,
  useAssistantFileLinkEnvironmentBridge,
  type AssistantFileLinkResolverProviderProps,
} from "./provider";
export type { AssistantFileLinkSource } from "./resolver";
export { useAssistantFileLinkActions, useFileLink } from "./use-file-link";

export { createInlinePathOpener } from "./path-open";
export {
  canOpenFileLinkWithDefaultApp,
  useFileLinkDesktopActions,
  useOpenFileLinkWithDefaultApp,
  type FileLinkDesktopActions,
} from "./desktop-actions";
