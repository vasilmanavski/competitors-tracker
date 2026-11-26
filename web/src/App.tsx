import { CompetitorList } from "./competitors/CompetitorList.tsx";
import { useHashRoute } from "./router.ts";
import { Timeline } from "./timeline/Timeline.tsx";

export function App() {
  const route = useHashRoute();
  return (
    <main className="card">
      <h1 className="brand">
        <a href="#/">CompetitorPulse</a>
      </h1>
      {route.view === "list" ? <CompetitorList /> : <Timeline key={route.id} id={route.id} />}
    </main>
  );
}
