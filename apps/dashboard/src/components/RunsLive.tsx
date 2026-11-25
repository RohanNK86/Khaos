"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDuration, formatTime, runDurationMs } from "../lib/format";
import type { RunRow } from "../lib/runs";
import { EmptyState, StatusBadge } from "./ui";
import { usePoll } from "./usePoll";

export function RunsLive({ initial }: { initial: RunRow[] }) {
  const { data, error } = usePoll<{ runs: RunRow[] }>("/api/runs", { runs: initial });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <p className="mb-3 flex items-center gap-2 text-sm font-bold">
        <span className="inline-block h-3 w-3 animate-pulse rounded-full border-2 border-ink bg-green-400" />
        Live · refreshes every 2 s {error && <span className="text-red-700">({error})</span>}
      </p>
      {data.runs.length === 0 ? (
        <EmptyState title="No runs yet">Ask your agent to use a tool, or run one from the MCP server.</EmptyState>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="tbl text-lg">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Status</th>
                <th>Mode</th>
                <th>Dry run</th>
                <th>Started</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/runs/${r.id}`} className="font-bold underline">
                      {r.toolTitle}
                    </Link>
                    <div className="font-mono text-sm">
                      {r.toolName} v{r.toolVersion}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>{r.mode}</td>
                  <td>{r.dryRun ? <span className="badge bg-sky-200">dry run</span> : "no"}</td>
                  <td className="whitespace-nowrap">{formatTime(r.startedAt)}</td>
                  <td suppressHydrationWarning>{formatDuration(runDurationMs(r, now))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
