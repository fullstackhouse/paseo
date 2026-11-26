import { createContext } from "react";

/** True inside `MarkdownRenderer external`: its links never reach a plugin link handler. */
export const MarkdownExternalContext = createContext(false);
