import type { TabImage } from "./service.js";

export interface FrameProductionContents {
  isDestroyed(): boolean;
  getBackgroundThrottling(): boolean;
  setBackgroundThrottling(allowed: boolean): void;
  beginFrameSubscription(onlyDirty: boolean, callback: (image: TabImage) => void): void;
  endFrameSubscription(): void;
}

/**
 * The single owner of one guest's background-throttling override and frame subscription.
 * Electron allows one frame subscription per WebContents, and throttling is one flag, so
 * screenshots and live views that overlap must share them instead of saving and
 * restoring each other's state.
 */
export class FrameProduction {
  private throttlingHolds = 0;
  private throttlingBefore = true;
  private paintingHolds = 0;
  private readonly frameListeners = new Set<(image: TabImage) => void>();
  private subscribed = false;

  public constructor(private readonly contents: FrameProductionContents) {}

  /** Disables background throttling until every hold is released. */
  public holdThrottling(): () => void {
    if (this.throttlingHolds === 0) {
      this.throttlingBefore = this.contents.getBackgroundThrottling();
      this.contents.setBackgroundThrottling(false);
    }
    this.throttlingHolds += 1;
    return once(() => {
      this.throttlingHolds -= 1;
      if (this.throttlingHolds === 0 && !this.contents.isDestroyed()) {
        this.contents.setBackgroundThrottling(this.throttlingBefore);
      }
    });
  }

  /**
   * Keeps the guest compositing until released. A hidden or occluded <webview> paints
   * nothing on its own, even with background throttling off; a frame subscription makes it.
   */
  public holdPainting(): () => void {
    const releaseThrottling = this.holdThrottling();
    this.paintingHolds += 1;
    this.sync();
    return once(() => {
      this.paintingHolds -= 1;
      this.sync();
      releaseThrottling();
    });
  }

  /** Receives rendered frames until the returned function runs. */
  public onFrame(listener: (image: TabImage) => void): () => void {
    this.frameListeners.add(listener);
    this.sync();
    return once(() => {
      this.frameListeners.delete(listener);
      this.sync();
    });
  }

  private sync(): void {
    if (this.contents.isDestroyed()) {
      this.subscribed = false;
      return;
    }
    const wanted = this.paintingHolds > 0 || this.frameListeners.size > 0;
    if (wanted && !this.subscribed) {
      this.contents.beginFrameSubscription(false, (image) => {
        for (const listener of this.frameListeners) listener(image);
      });
      this.subscribed = true;
    } else if (!wanted && this.subscribed) {
      this.subscribed = false;
      this.contents.endFrameSubscription();
    }
  }
}

function once(run: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    run();
  };
}
