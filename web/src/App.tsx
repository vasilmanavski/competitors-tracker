import { useEffect, useState } from "react";

type Health =
  | { state: "loading" }
  | { state: "ok" }
  | { state: "error"; message: string };

export function App() {
  const [health, setHealth] = useState<Health>({ state: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`API answered ${res.status}`);
        setHealth({ state: "ok" });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setHealth({ state: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>CompetitorPulse</h1>
      {health.state === "loading" && <p>Checking API…</p>}
      {health.state === "ok" && <p>API OK</p>}
      {health.state === "error" && <p>API unreachable: {health.message}</p>}
    </main>
  );
}
