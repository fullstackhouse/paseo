import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const CONTROL_CHANNEL = "paseo:browser-human-control";
const CONTROL_REPLY_CHANNEL = "paseo:browser-human-control-reply";
const SENTINEL = "LV3-SENTINEL-preload";

type IpcListener = (event: unknown, payload: unknown) => void;

interface GuestFrameStub {
  parent: GuestFrameStub | null;
  insertText(text: string): void;
}

const electron = vi.hoisted(() => ({
  listeners: new Map<string, (event: unknown, payload: unknown) => void>(),
  sent: [] as Array<[string, unknown]>,
  webFrame: { parent: null, insertText: () => {} } as {
    parent: unknown;
    insertText(text: string): void;
  },
}));

vi.mock("electron", () => ({
  ipcRenderer: {
    on: (channel: string, listener: IpcListener) => electron.listeners.set(channel, listener),
    send: (channel: string, payload?: unknown) => electron.sent.push([channel, payload]),
  },
  webFrame: electron.webFrame,
}));

class FakeElement {
  public shadowRoot: null = null;
  public isContentEditable = false;
  public constructor(public readonly tagName: string) {}
}

class FakeInput extends FakeElement {
  public name = "";
  public id = "";
  public readOnly = false;
  public disabled = false;
  public inputMode = "";
  public maxLength = -1;
  public pattern = "";
  public form: object | null = null;
  public visible = true;
  public onInput: (() => void) | null = null;
  public readonly typeChanges: string[] = [];
  private readonly attributes = new Map<string, string>();
  private currentValue = "";

  public constructor(type: string, autocomplete = "") {
    super("INPUT");
    this.attributes.set("type", type);
    if (autocomplete) this.attributes.set("autocomplete", autocomplete);
  }

  public get type(): string {
    return this.attributes.get("type") ?? "text";
  }
  public get value(): string {
    return this.currentValue;
  }
  public set value(value: string) {
    this.currentValue = value;
  }
  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  public setAttribute(name: string, value: string): void {
    if (name === "type") this.typeChanges.push(value);
    this.attributes.set(name, value);
  }
  public removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  public select(): void {}
  public focus(): void {
    FakeDocument.active = this;
  }
  public getClientRects(): object[] {
    return this.visible ? [{}] : [];
  }
  public getRootNode(): unknown {
    return document;
  }
  public dispatchEvent(): boolean {
    return true;
  }
}

class FakeTextArea extends FakeElement {
  public value = "";
}

class FakeDocument {
  public static active: FakeElement | null = null;
  public static focused = true;
  public static inputs: FakeInput[] = [];
  public querySelectorAll(): FakeInput[] {
    return FakeDocument.inputs;
  }
  public get activeElement(): FakeElement | null {
    return FakeDocument.active;
  }
  public hasFocus(): boolean {
    return FakeDocument.focused;
  }
}

interface FakeEvent {
  isTrusted: boolean;
  defaultPrevented: boolean;
  composedPath(): FakeElement[];
  preventDefault(): void;
  stopImmediatePropagation(): void;
}

class FakeWindow {
  public readonly listeners = new Map<string, Set<(event: never) => void>>();
  public addEventListener(type: string, listener: (event: never) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  public removeEventListener(type: string, listener: (event: never) => void): void {
    const listeners = this.listeners.get(type);
    listeners?.delete(listener);
    if (listeners?.size === 0) this.listeners.delete(type);
  }
  public dispatch(type: string, event: object): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never);
  }
}

let guestWindow: FakeWindow;

function editEvent(target: FakeElement): FakeEvent {
  const event: FakeEvent = {
    isTrusted: true,
    defaultPrevented: false,
    composedPath: () => [target],
    preventDefault: () => {
      event.defaultPrevented = true;
    },
    stopImmediatePropagation: () => {},
  };
  return event;
}

/** What Blink does for CommitText: two cancelable events, then the edit at the current focus. */
function commitText(text: string, duringBeforeInput?: () => void): void {
  const before = editEvent(FakeDocument.active!);
  guestWindow.dispatch("beforeinput", before);
  if (before.defaultPrevented) return;
  duringBeforeInput?.();
  const textInput = editEvent(FakeDocument.active!);
  guestWindow.dispatch("textInput", textInput);
  if (textInput.defaultPrevented) return;
  const edited = FakeDocument.active as FakeInput;
  edited.value = edited.maxLength >= 0 ? text.slice(0, edited.maxLength) : text;
  guestWindow.dispatch("input", editEvent(edited));
  edited.onInput?.();
}

let nextId = 0;

function request(payload: Record<string, unknown>): Record<string, unknown> {
  const id = `request-${++nextId}`;
  electron.listeners.get(CONTROL_CHANNEL)?.({}, { id, ...payload });
  const [channel, reply] = electron.sent.at(-1)!;
  expect(channel).toBe(CONTROL_REPLY_CHANNEL);
  expect(reply).toMatchObject({ id });
  return reply as Record<string, unknown>;
}

function focus(element: FakeElement): string {
  FakeDocument.active = element;
  const reply = request({ op: "describe" });
  return (reply.target as { targetId: string }).targetId;
}

function insert(
  targetId: string,
  deadline = Date.now() + 1000,
  text = SENTINEL,
  controlId = "control-1",
): Record<string, unknown> {
  return request({ op: "insert", controlId, targetId, text, deadline });
}

function clear(scope: "all" | "secrets", controlId = "control-1"): Record<string, unknown> {
  return request({ op: "clear", controlId, scope });
}

/** One-character boxes of a code, in document order. */
function codeBoxes(count: number, autoAdvance: boolean): FakeInput[] {
  const form = {};
  const boxes = Array.from({ length: count }, () => {
    const box = new FakeInput("text");
    box.maxLength = 1;
    box.form = form;
    return box;
  });
  FakeDocument.inputs = boxes;
  if (!autoAdvance) return boxes;
  for (const [index, box] of boxes.entries()) {
    box.onInput = () => boxes[index + 1]?.focus();
  }
  return boxes;
}

beforeEach(async () => {
  guestWindow = new FakeWindow();
  FakeDocument.active = null;
  FakeDocument.focused = true;
  FakeDocument.inputs = [];
  vi.stubGlobal("window", guestWindow);
  vi.stubGlobal("Document", FakeDocument);
  vi.stubGlobal("document", new FakeDocument());
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("HTMLInputElement", FakeInput);
  vi.stubGlobal("HTMLTextAreaElement", FakeTextArea);
  electron.listeners.clear();
  electron.sent.length = 0;
  electron.webFrame.parent = null;
  electron.webFrame.insertText = (text) => commitText(text);
  vi.resetModules();
  await import("./guest-preload.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser guest preload", () => {
  test("loading only adds the human control listener to the keyboard preload", () => {
    expect([...guestWindow.listeners.keys()]).toEqual(["keydown"]);
    expect([...electron.listeners.keys()].sort()).toEqual([
      CONTROL_CHANNEL,
      "paseo:browser-keyboard-policy",
    ]);
    expect(electron.sent).toEqual([["paseo:browser-keyboard-policy-request", undefined]]);
  });

  test.each(["main frame", "iframe"])("forwards page-first shortcuts from the %s", (frame) => {
    if (frame === "iframe") {
      electron.webFrame.parent = { parent: null, insertText: () => {} } satisfies GuestFrameStub;
    }
    const prefix = {
      alt: false,
      code: "KeyK",
      control: false,
      key: "k",
      meta: true,
      shift: false,
    };
    electron.listeners.get("paseo:browser-keyboard-policy")?.(
      {},
      { browserId: "browser-1", prefixes: [prefix], menuPrefixes: [] },
    );
    const event = {
      isTrusted: true,
      defaultPrevented: false,
      target: new FakeElement("BODY"),
      altKey: false,
      code: "KeyK",
      ctrlKey: false,
      key: "k",
      metaKey: true,
      repeat: false,
      shiftKey: false,
      preventDefault: () => {},
    };
    guestWindow.dispatch("keydown", event);
    expect(electron.sent.at(-1)).toEqual([
      "paseo:browser-shortcut-input",
      expect.objectContaining({ browserId: "browser-1", code: "KeyK", meta: true }),
    ]);
  });

  test.each([
    ["password", "", "password"],
    ["text", "current-password", "password"],
    ["password", "new-password", "new_password"],
    ["text", "one-time-code", "one_time_code"],
    ["text", "cc-number", "secret"],
    ["text", "username webauthn", "username"],
    ["email", "", "email"],
    ["search", "", "text"],
  ])("describes a %s field with autocomplete %j as %s", (type, autocomplete, kind) => {
    FakeDocument.active = new FakeInput(type, autocomplete);
    expect(request({ op: "describe" }).target).toMatchObject({ kind });
  });

  test("treats a short numeric field as a one-time code", () => {
    const field = new FakeInput("text");
    field.inputMode = "numeric";
    field.maxLength = 6;
    FakeDocument.active = field;
    expect(request({ op: "describe" }).target).toMatchObject({ kind: "one_time_code" });
  });

  test("offers no target outside editable fields or without document focus", () => {
    const contentEditable = new FakeElement("DIV");
    contentEditable.isContentEditable = true;
    for (const element of [new FakeInput("checkbox"), contentEditable]) {
      FakeDocument.active = element;
      expect(request({ op: "describe" }).target).toBeNull();
    }
    FakeDocument.active = new FakeInput("password");
    FakeDocument.focused = false;
    expect(request({ op: "describe" }).target).toBeNull();
  });

  test("commits through its local root, as a nested cross-origin iframe needs", () => {
    const commits: string[] = [];
    const localRoot: GuestFrameStub = {
      parent: null,
      insertText: (text) => {
        commits.push("local root");
        commitText(text);
      },
    };
    electron.webFrame.parent = localRoot;
    electron.webFrame.insertText = () => commits.push("non-root frame");
    const field = new FakeInput("password");

    expect(insert(focus(field))).toMatchObject({ inserted: true });
    expect(field.value).toBe(SENTINEL);
    expect(commits).toEqual(["local root"]);
    expect([...guestWindow.listeners.keys()]).toEqual(["keydown"]);
  });

  test("refuses when another field, even another password field, took focus", () => {
    const targetId = focus(new FakeInput("password"));
    const other = new FakeInput("password");
    FakeDocument.active = other;
    expect(insert(targetId)).toMatchObject({ inserted: false });
    expect(other.value).toBe("");
  });

  test("refuses when the field itself changed type", () => {
    const field = new FakeInput("password");
    const targetId = focus(field);
    field.setAttribute("type", "text");
    expect(insert(targetId)).toMatchObject({ inserted: false });
    expect(field.value).toBe("");
  });

  test("refuses when the document lost focus to another frame", () => {
    const field = new FakeInput("password");
    const targetId = focus(field);
    FakeDocument.focused = false;
    expect(insert(targetId)).toMatchObject({ inserted: false });
    expect(field.value).toBe("");
  });

  test("refuses a request that arrives after main gave up on it", () => {
    const field = new FakeInput("password");
    expect(insert(focus(field), Date.now() - 1)).toMatchObject({ inserted: false });
    expect(field.value).toBe("");
  });

  test("blocks a page that moves focus while the text is being committed", () => {
    const field = new FakeInput("password");
    const decoy = new FakeInput("text");
    const targetId = focus(field);
    electron.webFrame.insertText = (text) =>
      commitText(text, () => {
        FakeDocument.active = decoy;
      });
    expect(insert(targetId)).toMatchObject({ inserted: false });
    expect([field.value, decoy.value]).toEqual(["", ""]);
  });

  test("clears text that still landed in another field", () => {
    const decoy = new FakeInput("text");
    const targetId = focus(new FakeInput("password"));
    electron.webFrame.insertText = (text) => {
      decoy.value = text;
      guestWindow.dispatch("input", editEvent(decoy));
    };
    expect(insert(targetId)).toMatchObject({ inserted: false });
    expect(decoy.value).toBe("");
  });

  test("accepts a field that moves focus on after it received the text", () => {
    const first = new FakeInput("text", "one-time-code");
    const targetId = focus(first);
    electron.webFrame.insertText = (text) => {
      commitText(text);
      FakeDocument.active = new FakeInput("text");
    };
    expect(insert(targetId)).toMatchObject({ inserted: true });
  });

  const typeCode = (box: FakeInput, code: string) => insert(focus(box), Date.now() + 1000, code);
  const values = (boxes: FakeInput[]) => boxes.map((box) => box.value);

  test.each([true, false])("spreads a code over its boxes (auto-advance %s)", (autoAdvance) => {
    const boxes = codeBoxes(6, autoAdvance);

    expect(typeCode(boxes[0]!, "482915")).toMatchObject({ inserted: true });
    expect(values(boxes)).toEqual(["4", "8", "2", "9", "1", "5"]);

    clear("secrets");
    expect(values(boxes)).toEqual(["", "", "", "", "", ""]);
  });

  test("offers a code box's hints for one-character boxes", () => {
    const [first] = codeBoxes(4, false);
    FakeDocument.active = first!;
    expect(request({ op: "describe" }).target).toMatchObject({ kind: "one_time_code" });
  });

  test("a code may end a form that clears the last box", () => {
    const boxes = codeBoxes(3, true);
    boxes[2]!.onInput = () => {
      boxes[2]!.value = "";
      FakeDocument.active = null; // The form went away.
    };
    expect(typeCode(boxes[0]!, "123")).toMatchObject({ inserted: true });
  });

  test.each([
    ["too few boxes", (boxes: FakeInput[]) => boxes.slice(0, 2)],
    ["another form in between", (boxes: FakeInput[]) => ((boxes[1]!.form = {}), boxes)],
    ["a hidden box in between", (boxes: FakeInput[]) => ((boxes[1]!.visible = false), boxes)],
    ["a read-only box in between", (boxes: FakeInput[]) => ((boxes[1]!.readOnly = true), boxes)],
  ])("types nothing with %s, and says it doesn't fit", (_name, change) => {
    const boxes = codeBoxes(3, false);
    FakeDocument.inputs = change(boxes);

    expect(typeCode(boxes[0]!, "123")).toMatchObject({ inserted: false, reason: "does_not_fit" });
    expect(values(boxes)).toEqual(["", "", ""]);
  });

  test("takes back a partial code when a box's handler steals focus", () => {
    const boxes = codeBoxes(4, true);
    const decoy = new FakeInput("text");
    let commits = 0;
    electron.webFrame.insertText = (text) =>
      commitText(text, () => {
        if (++commits === 3) decoy.focus();
      });

    expect(typeCode(boxes[0]!, "1234")).toMatchObject({ inserted: false });
    expect([...values(boxes), decoy.value]).toEqual(["", "", "", "", ""]);
  });

  test("takes back a partial code when the document loses focus", () => {
    const boxes = codeBoxes(3, true);
    boxes[0]!.onInput = () => (FakeDocument.focused = false);
    expect(typeCode(boxes[0]!, "123")).toMatchObject({ inserted: false });
    expect(values(boxes)).toEqual(["", "", ""]);
  });

  test("refuses text longer than the field instead of cutting it", () => {
    const field = new FakeInput("password");
    field.maxLength = 8;
    expect(insert(focus(field), Date.now() + 1000, "nine-char")).toMatchObject({
      inserted: false,
      reason: "does_not_fit",
    });
    expect(field.value).toBe("");
  });

  test("reports and takes back text the page cut short", () => {
    const field = new FakeInput("text");
    field.onInput = () => (field.value = field.value.slice(0, 1));
    expect(typeCode(field, "482915")).toMatchObject({ inserted: false, reason: "does_not_fit" });
    expect(field.value).toBe("");
  });

  test("reports text the page didn't take at all", () => {
    const field = new FakeInput("text");
    electron.webFrame.insertText = () => {};
    expect(typeCode(field, "482915")).toMatchObject({ inserted: false, reason: "does_not_fit" });
  });

  test.each([
    ["adds separators", (value: string) => `${value.slice(0, 3)}-${value.slice(3)}`, "482915"],
    ["drops separators", (value: string) => value.replace(" ", ""), "482 915"],
  ])("accepts a field that %s", (_name, format, text) => {
    const field = new FakeInput("text");
    field.onInput = () => (field.value = format(field.value));
    expect(typeCode(field, text)).toMatchObject({ inserted: true });
  });

  test("accepts a field that submits and clears", () => {
    const field = new FakeInput("text");
    field.onInput = () => {
      field.value = "";
      FakeDocument.active = null;
    };
    expect(typeCode(field, "482915")).toMatchObject({ inserted: true });
  });

  test.each(["", "111111"])("reports text the page rejected back to %j", (previous) => {
    const field = new FakeInput("text");
    field.value = previous;
    field.onInput = () => (field.value = previous);
    expect(typeCode(field, "abcdef")).toMatchObject({ inserted: false, reason: "does_not_fit" });
  });

  test("accepts and later clears a code the page spread out itself", () => {
    const boxes = [new FakeInput("text", "one-time-code"), new FakeInput("text")];
    FakeDocument.inputs = boxes;
    boxes[0]!.onInput = () => {
      boxes[1]!.value = boxes[0]!.value.slice(1);
      boxes[0]!.value = boxes[0]!.value.slice(0, 1);
    };

    expect(typeCode(boxes[0]!, "42")).toMatchObject({ inserted: true });
    expect(values(boxes)).toEqual(["4", "2"]);
    clear("secrets");
    expect(values(boxes)).toEqual(["", ""]);
  });

  test("a later control doesn't clear what an earlier one typed, or the agent since", () => {
    const password = new FakeInput("password");
    const user = new FakeInput("text", "username");
    insert(focus(password));
    clear("secrets");
    password.value = "typed by the agent";

    insert(focus(user), Date.now() + 1000, "someone", "control-2");
    clear("secrets", "control-2");
    expect(password.value).toBe("typed by the agent");

    expect(clear("all", "control-3")).toMatchObject({ typed: false });
    expect(user.value).toBe("someone");
  });

  test("hand-back clears secrets and their undo stack, and leaves other fields", () => {
    const user = new FakeInput("text", "username");
    const password = new FakeInput("password");
    insert(focus(user));
    insert(focus(password));

    expect(clear("secrets")).toMatchObject({ typed: true });
    expect(password.value).toBe("");
    // A cleared value comes back with execCommand("undo") unless the inner editor is rebuilt.
    expect(password.typeChanges).toEqual(["hidden", "password"]);
    expect(user.value).toBe(SENTINEL);

    clear("all");
    expect(user.value).toBe("");
  });

  test("a document live view never typed into reports nothing typed", () => {
    expect(clear("all")).toMatchObject({ typed: false });
  });

  test("never sends the typed text back over IPC", () => {
    insert(focus(new FakeInput("password")));
    clear("all");
    expect(JSON.stringify(electron.sent)).not.toContain(SENTINEL);
  });
});
