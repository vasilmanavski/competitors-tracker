export type CircuitBreakerOptions = {
  failureThreshold: number;
  cooldownMs: number;
  now?: () => Date;
};

export type CircuitState = "closed" | "open" | "half_open";

/**
 * Stops calling a dependency that keeps failing, so failed calls don't use up a budget.
 * Closed: calls flow. After `failureThreshold` failures in a row it opens and allows no
 * calls for `cooldownMs`. Then it is half-open: one trial call at a time, which closes it
 * on success and reopens it on failure. State is per process.
 */
export function createCircuitBreaker(options: CircuitBreakerOptions) {
  const { failureThreshold, cooldownMs, now = () => new Date() } = options;
  let state: CircuitState = "closed";
  let consecutiveFailures = 0;
  let openedAt = 0;

  function open(): void {
    state = "open";
    openedAt = now().getTime();
  }

  return {
    /**
     * How many of `wanted` new calls may start now, given `inFlight` calls already running.
     * Half-open allows one trial call, and only when nothing else is running.
     */
    allowedCalls(wanted: number, inFlight: number): number {
      if (state === "open" && now().getTime() - openedAt >= cooldownMs) state = "half_open";
      switch (state) {
        case "closed":
          return wanted;
        case "open":
          return 0;
        case "half_open":
          return inFlight === 0 ? Math.min(wanted, 1) : 0;
      }
    },

    /** @returns true when this success closed a circuit that was open or half-open */
    recordSuccess(): boolean {
      const wasClosed = state === "closed";
      state = "closed";
      consecutiveFailures = 0;
      return !wasClosed;
    },

    /** @returns true when this failure opened the circuit */
    recordFailure(): boolean {
      consecutiveFailures += 1;
      if (state === "half_open" || (state === "closed" && consecutiveFailures >= failureThreshold)) {
        open();
        return true;
      }
      return false;
    },

    get state(): CircuitState {
      return state;
    },
  };
}

export type CircuitBreaker = ReturnType<typeof createCircuitBreaker>;
