interface DialogContents {
  on(event: "-run-dialog", listener: (info: unknown, answer: DialogAnswer) => void): void;
  on(event: "-cancel-dialogs", listener: () => void): void;
  emit(event: "-cancel-dialogs"): boolean;
}

type DialogAnswer = (accept: boolean, text: string) => void;

const openDialogs = new WeakMap<object, DialogAnswer>();

/**
 * Keeps the answer of a tab's open JavaScript dialog. CDP can answer only a dialog that opened
 * after Page.enable, and Page.enable itself hangs behind one in the main frame. Electron has no
 * public API for either, so this uses the events its own message box is built on (Electron 44,
 * lib/browser/api/web-contents.ts); browser-live-input.electron.mjs covers it.
 */
export function observePageDialogs(target: object): void {
  const contents = target as DialogContents;
  contents.on("-run-dialog", (_info, answer) => openDialogs.set(contents, answer));
  contents.on("-cancel-dialogs", () => openDialogs.delete(contents));
}

/** Answers the open dialog, if there is one, and closes its message box on the desktop. */
export function dismissPageDialog(target: object, accept = false): void {
  const answer = openDialogs.get(target);
  if (!answer) return;
  openDialogs.delete(target);
  // Closing first keeps Electron from answering as well: an answer works once.
  (target as DialogContents).emit("-cancel-dialogs");
  try {
    answer(accept, "");
  } catch {
    // It was already answered at the desktop.
  }
}
