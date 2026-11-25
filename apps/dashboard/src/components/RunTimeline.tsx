import type { TimelineEntry } from "../lib/format";
import { describeLocator, formatDuration, humanize, statusClass } from "../lib/format";
import { RiskBadge } from "./ui";

const ICONS: Record<TimelineEntry["state"], string> = {
  passed: "✓",
  failed: "✗",
  awaiting: "…",
  blocked_dry_run: "⛔",
  skipped: "–",
  pending: "",
};

function Checks({ label, results }: { label: string; results: { ok: boolean; detail?: string }[] }) {
  if (results.length === 0) return null;
  return (
    <span className="mr-3">
      {results.map((c, i) => (
        <span key={i} className={`mr-2 font-bold ${c.ok ? "text-green-700" : "text-red-700"}`}>
          {label} {c.ok ? "✓" : "✗"}
          {c.detail && <span className="font-normal"> {c.detail}</span>}
        </span>
      ))}
    </span>
  );
}

export function RunTimeline({ entries, blobHref }: { entries: TimelineEntry[]; blobHref: (id: string) => string }) {
  return (
    <ol className="relative ml-5 border-l-[3px] border-ink">
      {entries.map(({ step, trace, state }) => (
        <li key={step.id} className={`relative pb-5 pl-8 ${state === "pending" ? "opacity-50" : ""}`}>
          <span
            className={`absolute -left-[17px] top-0 flex h-8 w-8 items-center justify-center rounded-full border-[3px] border-ink font-bold ${state === "pending" ? "bg-white" : statusClass(state)}`}
          >
            {ICONS[state]}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold">{step.intent}</span>
            <RiskBadge risk={step.risk} />
            {state !== "pending" && <span className={`badge ${statusClass(state)}`}>{humanize(state)}</span>}
            {trace && <span className="text-sm text-neutral-600">{formatDuration(trace.durationMs)}</span>}
          </div>
          {trace && (
            <div className="mt-1 text-sm">
              {trace.usedLocator && (
                <span className="mr-3">
                  found by <b className="font-mono">{describeLocator(trace.usedLocator)}</b>
                </span>
              )}
              <Checks label="pre" results={trace.preResults} />
              <Checks label="post" results={trace.postResults} />
              {trace.error && <p className="mt-1 font-bold text-red-700">{trace.error}</p>}
              {state === "blocked_dry_run" && <p className="mt-1 font-bold">DRY RUN: blocked here, nothing was sent.</p>}
              {trace.evidenceBlobId && (
                <a href={blobHref(trace.evidenceBlobId)} target="_blank" rel="noreferrer" className="underline">
                  DOM snapshot evidence ↗
                </a>
              )}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
