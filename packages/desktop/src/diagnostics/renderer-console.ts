import { app } from "electron";
import type { LogMessage } from "electron-log";

const LEVELS = ["debug", "info", "warn", "error"] as const;

/**
 * electron-log's spyRendererConsole, minus the tabs it must leave out. The spy can't be used:
 * it writes every webContents' console to main.log and can't tell them apart, and a page can log
 * what live view typed into it.
 */
export function logRendererConsoles(input: {
  log: { processMessage(message: LogMessage): void };
  isWithheld: (contentsId: number) => boolean;
}): void {
  app.on("web-contents-created", (_event, contents) => {
    const contentsId = contents.id;
    contents.on("console-message", (_details, level, message) => {
      if (input.isWithheld(contentsId)) return;
      input.log.processMessage({
        data: [message],
        level: LEVELS[level],
        variables: { processType: "renderer" },
      } as LogMessage);
    });
  });
}
