import type { TabContents } from "./service.js";

type Method = (...args: unknown[]) => unknown;

export class AgentCommandCancelledError extends Error {
  public constructor() {
    super("The agent's browser command was cancelled.");
    this.name = "AgentCommandCancelledError";
  }
}

/**
 * One agent command on a tab, until a human takes the tab. Cancelling answers the agent at once,
 * takes away the command's access to the tab, and drops whatever its calls still return. What it
 * already started in the page keeps going: isPending() says whether that needs ending.
 */
export class AgentCommand {
  public cancelled = false;
  private readonly pending = new Map<Promise<unknown>, PropertyKey>();
  private readonly cancellation: Promise<never>;
  private rejectCancellation!: (error: Error) => void;

  public constructor() {
    this.cancellation = new Promise<never>((_resolve, reject) => {
      this.rejectCancellation = reject;
    });
    this.cancellation.catch(() => {});
  }

  public async run<T>(work: (command: AgentCommand) => T | Promise<T>): Promise<T> {
    const result = await this.untilCancelled(Promise.resolve(work(this)));
    this.throwIfCancelled();
    return result;
  }

  public cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.rejectCancellation(new AgentCommandCancelledError());
  }

  public isPending(method: keyof TabContents): boolean {
    return [...this.pending.values()].includes(method);
  }

  public async settled(): Promise<void> {
    await Promise.allSettled(this.pending.keys());
  }

  /** The tab as this command sees it. */
  public guard(tab: TabContents): TabContents {
    return new Proxy(tab, {
      get: (target, property) => {
        const value: unknown = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        const call = (...args: unknown[]) => {
          this.throwIfCancelled();
          const result = (value as Method).apply(target, args);
          return result instanceof Promise
            ? this.untilCancelled(this.follow(property, result))
            : result;
        };
        if (property !== "executeJavaScript") return call;
        return async (...args: unknown[]) => {
          // Electron holds a script until loading stops and then runs it in whatever document is
          // there. Waiting here instead means a cancelled command's script never starts.
          await this.untilCancelled(target.waitUntilScriptable?.() ?? Promise.resolve());
          return call(...args);
        };
      },
    });
  }

  private follow<T>(property: PropertyKey, work: Promise<T>): Promise<T> {
    this.pending.set(work, property);
    const settle = () => this.pending.delete(work);
    work.then(settle, settle);
    return work;
  }

  private untilCancelled<T>(work: Promise<T>): Promise<T> {
    return Promise.race([work, this.cancellation]);
  }

  private throwIfCancelled(): void {
    if (this.cancelled) throw new AgentCommandCancelledError();
  }
}
