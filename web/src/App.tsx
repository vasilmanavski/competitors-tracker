import { useEffect, useState } from "react";
import { CompetitorList } from "./CompetitorList.tsx";
import { Timeline } from "./Timeline.tsx";

// Two views, so a hash router is enough: "#/" is the list,
// "#/competitors/<id>" is that competitor's timeline. No router dependency,
// and links survive a reload because nginx/Vite only ever serve index.html.
type Route = { view: "list" } | { view: "timeline"; id: string };

function parseRoute(hash: string): Route {
  const match = /^#\/competitors\/([^/]+)$/.exec(hash);
  return match?.[1] ? { view: "timeline", id: decodeURIComponent(match[1]) } : { view: "list" };
}

export function App() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "0 1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>
        <a href="#/" style={{ color: "inherit", textDecoration: "none" }}>
          CompetitorPulse
        </a>
      </h1>
      {route.view === "list" ? <CompetitorList /> : <Timeline key={route.id} id={route.id} />}
    </main>
  );
}
