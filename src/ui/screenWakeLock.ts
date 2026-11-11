interface ScreenWakeLockSentinel extends EventTarget {
  release(): Promise<void>;
}

interface ScreenWakeLock {
  request(type: "screen"): Promise<ScreenWakeLockSentinel>;
}

type WakeLockNavigator = Navigator & { wakeLock?: ScreenWakeLock };

export function keepScreenAwake(): void {
  const wakeLock = (navigator as WakeLockNavigator).wakeLock;
  if (!wakeLock) return;

  let sentinel: ScreenWakeLockSentinel | null = null;
  let requestInFlight = false;

  const requestLock = async (): Promise<void> => {
    if (document.visibilityState !== "visible" || sentinel || requestInFlight) return;
    requestInFlight = true;
    try {
      const requested = await wakeLock.request("screen");
      if (document.visibilityState === "visible") {
        sentinel = requested;
        requested.addEventListener("release", () => {
          if (sentinel === requested) sentinel = null;
        }, { once: true });
      } else {
        await requested.release();
      }
    } catch (error) {
      console.warn("Could not keep the screen awake.", error);
    } finally {
      requestInFlight = false;
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void requestLock();
    else sentinel = null;
  });
  void requestLock();
}
