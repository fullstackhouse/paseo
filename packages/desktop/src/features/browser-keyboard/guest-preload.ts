import { ipcRenderer, webFrame } from "electron";
import type {
  GuestControlReply,
  GuestControlRequest,
  GuestFieldKind,
} from "../browser-automation/guest-frames.js";
import type { BrowserKeyboardPolicy, BrowserShortcutPrefix } from "./policy.js";

const POLICY_CHANNEL = "paseo:browser-keyboard-policy";
const POLICY_REQUEST_CHANNEL = "paseo:browser-keyboard-policy-request";
const SHORTCUT_INPUT_CHANNEL = "paseo:browser-shortcut-input";
const CONTROL_CHANNEL = "paseo:browser-human-control";
const CONTROL_REPLY_CHANNEL = "paseo:browser-human-control-reply";

let browserId: string | null = null;
let policy: BrowserShortcutPrefix[] = [];

interface BrowserKeyboardPolicyPayload extends BrowserKeyboardPolicy {
  browserId: string;
}

function matchesPolicy(event: KeyboardEvent): boolean {
  const editable = isEditableTarget(event.target);
  return policy.some((prefix) => {
    if (
      prefix.alt !== event.altKey ||
      prefix.control !== event.ctrlKey ||
      prefix.meta !== event.metaKey ||
      prefix.shift !== event.shiftKey ||
      (prefix.editable === false && editable) ||
      (prefix.repeat === false && event.repeat)
    ) {
      return false;
    }
    if (prefix.key === undefined) {
      return matchesCode(prefix.code, event.code);
    }
    const eventKey = event.key.toLowerCase();
    if (eventKey === prefix.key) {
      return true;
    }
    if (prefix.shift && prefix.shiftedKey !== undefined && eventKey === prefix.shiftedKey) {
      return true;
    }
    return (prefix.alt || prefix.codeFallback === true) && matchesCode(prefix.code, event.code);
  });
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  const element = target as HTMLElement;
  if (element.isContentEditable) {
    return true;
  }
  const tag = element.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function matchesCode(prefixCode: string, eventCode: string): boolean {
  if (prefixCode !== "Digit") {
    return prefixCode === eventCode;
  }
  return /^(?:Digit|Numpad)[1-9]$/.test(eventCode);
}

function stageShortcutForward(event: KeyboardEvent): void {
  if (!event.isTrusted || event.defaultPrevented || !browserId || !matchesPolicy(event)) {
    return;
  }

  const shortcutBrowserId = browserId;
  window.addEventListener(
    "keydown",
    (completedEvent) => {
      if (completedEvent !== event || completedEvent.defaultPrevented) {
        return;
      }
      completedEvent.preventDefault();
      ipcRenderer.send(SHORTCUT_INPUT_CHANNEL, {
        alt: completedEvent.altKey,
        browserId: shortcutBrowserId,
        code: completedEvent.code,
        control: completedEvent.ctrlKey,
        key: completedEvent.key,
        meta: completedEvent.metaKey,
        repeat: completedEvent.repeat,
        shift: completedEvent.shiftKey,
      });
    },
    { once: true },
  );
}

window.addEventListener("keydown", stageShortcutForward, { capture: true });

ipcRenderer.on(POLICY_CHANNEL, (_event, value: BrowserKeyboardPolicyPayload) => {
  if (!value || typeof value.browserId !== "string" || !Array.isArray(value.prefixes)) {
    return;
  }
  browserId = value.browserId;
  policy = value.prefixes;
});

ipcRenderer.send(POLICY_REQUEST_CHANNEL);

// Human control of this frame for live view. Page script can't reach any of it: this world is
// isolated, and only Electron main can send on the channel. Nothing is set up until main asks.
// insertText lives here because webContents.insertText runs webFrame.insertText in the main
// frame, which crashes the renderer while a cross-origin iframe has focus.
ipcRenderer.on(CONTROL_CHANNEL, (_event, request: GuestControlRequest) => {
  humanControl ??= createHumanControl();
  ipcRenderer.send(CONTROL_REPLY_CHANNEL, { id: request.id, ...humanControl.answer(request) });
});

type TextField = HTMLInputElement | HTMLTextAreaElement;
type InsertResult = Pick<GuestControlReply, "inserted" | "reason">;

const INSERTED: InsertResult = { inserted: true };
const REFUSED: InsertResult = { inserted: false };
const DOES_NOT_FIT: InsertResult = { inserted: false, reason: "does_not_fit" };
const UNCONFIRMED: InsertResult = { inserted: false, reason: "unconfirmed" };
const TEXT_INPUT_TYPES = new Set(["text", "password", "email", "tel", "number", "search", "url"]);

let humanControl: ReturnType<typeof createHumanControl> | null = null;

function createHumanControl() {
  // Prototype accessors, because a page's named elements can shadow properties of `document`.
  const getActiveElement = Object.getOwnPropertyDescriptor(
    Document.prototype,
    "activeElement",
  )!.get!;
  const hasFocus = Document.prototype.hasFocus;
  const documentId = [...crypto.getRandomValues(new Uint32Array(4))].join("-");
  const targets = new WeakMap<TextField, { signature: string; targetId: string }>();
  /** The fields the current control typed into, and whether each holds a secret. */
  const filled = new Map<TextField, boolean>();
  let filledBy: string | null = null;
  let nextTarget = 0;

  function activeElement(): Element | null {
    let element = getActiveElement.call(document) as Element | null;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element;
  }

  // No contenteditable: such an element can host another frame that has the real focus.
  function focusedField(): TextField | null {
    if (!hasFocus.call(document)) return null;
    const element = activeElement();
    const isField = element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement;
    return isField && isEditable(element) ? element : null;
  }

  function targetIdOf(field: TextField): string {
    const signature = JSON.stringify([
      field.type,
      field.getAttribute("autocomplete"),
      field.name,
      field.id,
    ]);
    const known = targets.get(field);
    if (known?.signature === signature) return known.targetId;
    const targetId = `${documentId}:${++nextTarget}`;
    targets.set(field, { signature, targetId });
    return targetId;
  }

  function isTarget(field: TextField | null, targetId: string): boolean {
    return field !== null && targetIdOf(field) === targetId;
  }

  // An agent may have typed into the same fields since an earlier control.
  function scopeTo(controlId: string): void {
    if (filledBy !== controlId) filled.clear();
    filledBy = controlId;
  }

  function insert(request: Extract<GuestControlRequest, { op: "insert" }>): InsertResult {
    if (Date.now() > request.deadline) return REFUSED;
    const field = focusedField();
    if (!field || !isTarget(field, request.targetId)) return REFUSED;
    const { text } = request;
    const characters = [...text];
    if (field.maxLength === 1 && characters.length > 1) return spreadOverBoxes(field, characters);
    // type=number has the attribute and ignores it.
    const limited = field.maxLength >= 0 && field.type !== "number";
    if (limited && text.length > field.maxLength) return DOES_NOT_FIT;

    return commitInto(field, text, isSecret(fieldKind(field)));
  }

  /** A code over one-character boxes: checked before the first, and stopped at any doubt. */
  function spreadOverBoxes(first: TextField, characters: string[]): InsertResult {
    const boxes = fieldsFrom(first).slice(0, characters.length);
    const fits =
      boxes.length === characters.length &&
      boxes.every(
        (box) =>
          box.maxLength === 1 &&
          box.form === first.form &&
          isEditable(box) &&
          box.getClientRects().length > 0,
      );
    if (!fits) return DOES_NOT_FIT;
    for (const [index, box] of boxes.entries()) {
      const notSent = index === 0 ? REFUSED : UNCONFIRMED;
      // The document keeps focus throughout, or it's another frame's turn to receive text.
      if (!hasFocus.call(document)) return notSent;
      if (focusedField() !== box) box.focus();
      if (focusedField() !== box) return notSent;
      const result = commitInto(box, characters[index]!, true);
      if (result === REFUSED) return notSent;
      if (result !== INSERTED) return result;
    }
    return INSERTED;
  }

  /**
   * REFUSED means never sent. Once the text is committed it is inserted only if it is exactly
   * what the field holds. What a page made of anything else isn't guessed, and isn't cleared.
   */
  function commitInto(field: TextField, text: string, secret: boolean): InsertResult {
    const targetId = targetIdOf(field);
    // Replace what is there; a password manager fills whole values.
    field.select();
    if (focusedField() !== field) return REFUSED;

    const edits: EventTarget[] = [];
    // Page handlers of these events can move focus, and the text follows focus.
    const guard = (event: Event) => {
      if (event.composedPath()[0] === field && isTarget(focusedField(), targetId)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const recordEdit = (event: Event) => {
      const [target] = event.composedPath();
      if (event.isTrusted && target) edits.push(target);
    };
    const guardedEvents = ["beforeinput", "textInput"];
    for (const type of guardedEvents) window.addEventListener(type, guard, true);
    window.addEventListener("input", recordEdit, true);
    try {
      filled.set(field, secret || filled.get(field) === true);
      let localRoot = webFrame;
      // Only a local root has the widget that commits text.
      while (localRoot.parent) localRoot = localRoot.parent;
      localRoot.insertText(text);
    } finally {
      for (const type of guardedEvents) window.removeEventListener(type, guard, true);
      window.removeEventListener("input", recordEdit, true);
    }
    const edited = edits[0];
    if (edited === field && field.value === text) return INSERTED;
    if (edited instanceof HTMLInputElement || edited instanceof HTMLTextAreaElement) {
      filled.set(edited, secret || filled.get(edited) === true);
    }
    return UNCONFIRMED;
  }

  return {
    answer(request: GuestControlRequest): Omit<GuestControlReply, "id"> {
      switch (request.op) {
        case "describe": {
          const field = focusedField();
          return {
            target: field ? { targetId: targetIdOf(field), kind: fieldKind(field) } : null,
          };
        }
        case "insert":
          scopeTo(request.controlId);
          return insert(request);
        case "clear":
          scopeTo(request.controlId);
          for (const [field, secret] of filled) {
            if (secret || request.scope === "all") clearField(field);
          }
          return { typed: filled.size > 0 };
      }
    },
  };
}

function fieldKind(field: TextField): GuestFieldKind {
  if (!(field instanceof HTMLInputElement)) return "text";
  const autocomplete = (field.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/);
  if (autocomplete.includes("new-password")) return "new_password";
  if (field.type === "password" || autocomplete.includes("current-password")) return "password";
  if (autocomplete.includes("one-time-code")) return "one_time_code";
  if (autocomplete.some((token) => token.startsWith("cc-"))) return "secret";
  if (autocomplete.includes("username")) return "username";
  if (field.type === "email" || autocomplete.includes("email")) return "email";
  if (isCodeBox(field)) return "one_time_code";
  const numeric = field.inputMode === "numeric" || field.type === "number" || field.type === "tel";
  if (numeric && field.maxLength > 0 && field.maxLength <= 8) return "one_time_code";
  return "text";
}

function isEditable(field: TextField): boolean {
  const takesText = !(field instanceof HTMLInputElement) || TEXT_INPUT_TYPES.has(field.type);
  return takesText && !field.readOnly && !field.disabled;
}

/** The inputs of the field's document or shadow root, without hidden ones, in document order. */
function inputsAround(field: TextField): HTMLInputElement[] {
  if (!(field instanceof HTMLInputElement)) return [];
  const root = field.getRootNode() as Document | ShadowRoot;
  const found =
    root === document
      ? Document.prototype.querySelectorAll.call(document, "input")
      : root.querySelectorAll("input");
  return (Array.from(found) as HTMLInputElement[]).filter((input) => input.type !== "hidden");
}

function fieldsFrom(field: TextField): HTMLInputElement[] {
  const inputs = inputsAround(field);
  const index = inputs.indexOf(field as HTMLInputElement);
  return index === -1 ? [] : inputs.slice(index);
}

function isCodeBox(field: HTMLInputElement): boolean {
  if (field.maxLength !== 1) return false;
  const inputs = inputsAround(field);
  const index = inputs.indexOf(field);
  if (index === -1) return false;
  return [inputs[index - 1], inputs[index + 1]].some(
    (next) => next?.maxLength === 1 && next.form === field.form,
  );
}

function isSecret(kind: GuestFieldKind): boolean {
  return ["password", "new_password", "one_time_code", "secret"].includes(kind);
}

function clearField(field: TextField): void {
  const isInput = field instanceof HTMLInputElement;
  const prototype = isInput ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, "");
  if (isInput) {
    // Setting value keeps the undo stack, so execCommand("undo") brings the text back. Changing
    // the type rebuilds the inner editor those undo steps point at.
    const type = field.getAttribute("type");
    field.setAttribute("type", "hidden");
    if (type === null) field.removeAttribute("type");
    else field.setAttribute("type", type);
  }
  field.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}
