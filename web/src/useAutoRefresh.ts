import { useEffect } from "react";

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
