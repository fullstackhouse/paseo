export type AdmissionPriority = "interactive" | "background";

export function higherPriority(a: AdmissionPriority, b: AdmissionPriority): AdmissionPriority {
  return a === "interactive" || b === "interactive" ? "interactive" : "background";
}

/** Mutable so a caller can promote work that is still waiting for a slot. */
export interface AdmissionTicket {
  priority: AdmissionPriority;
}

interface PendingAdmission {
  ticket: AdmissionTicket;
  start: () => void;
  reject: (reason: unknown) => void;
}

/**
 * A concurrency limit that admits interactive work before background work. Within one
 * priority, work runs in arrival order. A client waiting on a request must not queue
 * behind hundreds of background refreshes.
 */
export class PriorityAdmission {
  private readonly pending: PendingAdmission[] = [];
  private active = 0;

  constructor(private readonly concurrency: number) {}

  get activeCount(): number {
    return this.active;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  run<T>(ticket: AdmissionTicket, work: () => T | Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active += 1;
        // The work starts on the next microtask, as with p-limit (which this replaced), so a
        // request made right after this one still finds the work in flight and joins it.
        void Promise.resolve()
          .then(work)
          .then(resolve, reject)
          .finally(() => {
            this.active -= 1;
            this.admitNext();
          });
      };
      this.pending.push({ ticket, start, reject });
      this.admitNext();
    });
  }

  /** Rejects everything still waiting. Running work finishes on its own. */
  clear(): void {
    const abortError = AbortSignal.abort().reason;
    for (const entry of this.pending.splice(0)) {
      entry.reject(abortError);
    }
  }

  private admitNext(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const interactiveIndex = this.pending.findIndex(
        (entry) => entry.ticket.priority === "interactive",
      );
      const [next] = this.pending.splice(Math.max(interactiveIndex, 0), 1);
      next!.start();
    }
  }
}
