import { useEffect } from "react";

/** Re-check interval while something is waiting for its first poll (polled within ~1 s of being added). */
export const AWAITING_POLL_REFRESH_MS = 1_000;

/** Re-check interval otherwise: new polls only arrive once per poll interval per competitor. */
export const IDLE_REFRESH_MS = 15_000;

/** Calls `refresh` now and every `intervalMs`, aborting the in-flight request on unmount. */
export function useAutoRefresh(refresh: (signal: AbortSignal) => Promise<void>, intervalMs: number): void {
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => void refresh(controller.signal), intervalMs);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [refresh, intervalMs]);
}
