import { useEffect, useState } from "react";

export type Route = { view: "list" } | { view: "timeline"; id: string };

const TIMELINE_HASH = /^#\/competitors\/([^/]+)$/;

/** Parses the URL hash: `#/` is the list, `#/competitors/<id>` is that competitor's timeline. */
export function parseRoute(hash: string): Route {
  const id = TIMELINE_HASH.exec(hash)?.[1];
  return id ? { view: "timeline", id: decodeURIComponent(id) } : { view: "list" };
}

export function timelineHref(id: string): string {
  return `#/competitors/${encodeURIComponent(id)}`;
}

/** The current route, updated on every hash change. */
export function useHashRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return route;
}
