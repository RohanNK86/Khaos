"use client";
import { useEffect, useState } from "react";

/** Fetches JSON from `url` now and every `intervalMs` (default 2 s) until `stop(data)` is true. */
export function usePoll<T>(url: string, initial: T, stop: (data: T) => boolean = () => false, intervalMs = 2000) {
  const [data, setData] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);
  const done = stop(data);
  useEffect(() => {
    if (done) return;
    let alive = true;
    async function tick() {
      try {
        const res = await fetch(url, { cache: "no-store" });
        const json = (await res.json()) as T & { error?: string };
        if (!alive) return;
        if (!res.ok) setError(json.error ?? `HTTP ${res.status}`);
        else {
          setError(null);
          setData(json);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    }
    const timer = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [url, intervalMs, done]);
  return { data, error };
}
