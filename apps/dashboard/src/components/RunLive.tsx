"use client";
import Link from "next/link";
import { cancelRun, continueRun } from "../app/actions";
import { TERMINAL_RUN_STATUSES, buildTimeline, formatDuration, formatTime, runDurationMs } from "../lib/format";
import type { RunDetail } from "../lib/runs";
import { ActionForm } from "./ActionForm";
import { RunTimeline } from "./RunTimeline";
import { Card, KeyValues, Stat, StatusBadge } from "./ui";
import { usePoll } from "./usePoll";

function NeedPanel({ detail }: { detail: RunDetail }) {
  const { run } = detail;
  const need = run.need;
  if (!need) return null;
  return (
    <section className="card mb-6 bg-orange">
      {need.kind === "confirmation" ? (
        <>
          <h2 className="mb-2 text-2xl">Waiting for the user to confirm</h2>
          <p className="mb-3">Step <code>{need.stepId}</code> will send data. The agent reads this preview to the user:</p>
          <div className="mb-4 bg-white p-3">
            <KeyValues entries={need.preview.map((p) => [p.label, p.value])} />
          </div>
          <div className="flex flex-wrap gap-4">
            <ActionForm action={continueRun} hidden={{ id: run.id, approve: "true" }} label="Approve (Shall I submit? Yes)" variant="btn-primary" />
            <ActionForm action={continueRun} hidden={{ id: run.id, approve: "false" }} label="Decline" variant="btn-danger" />
          </div>
        </>
      ) : (
        <>
          <h2 className="mb-2 text-2xl">Waiting for the user: {need.prompt}</h2>
          <p className="mb-3">
            Step <code>{need.stepId}</code> needs <code>{need.param}</code>
            {need.sensitive && " (sensitive: never stored or logged)"}.
          </p>
          <ActionForm action={continueRun} hidden={{ id: run.id }} label="Send" variant="btn-primary">
            <input name="value" type={need.sensitive ? "password" : "text"} className="input" autoComplete="off" placeholder={need.param} required />
          </ActionForm>
        </>
      )}
    </section>
  );
}

export function RunLive({ initial, liveUrl }: { initial: RunDetail; liveUrl: string }) {
  const { data, error } = usePoll<RunDetail>(`/api/runs/${initial.run.id}`, initial, (d) => TERMINAL_RUN_STATUSES.has(d.run.status));
  const { run, tool } = data;
  const entries = tool ? buildTimeline(tool, run) : [];
  const passed = run.trace.filter((t) => t.status === "passed").length;
  const checks = run.trace.reduce((n, t) => n + t.preResults.length + t.postResults.length, 0);
  const live = !TERMINAL_RUN_STATUSES.has(run.status);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusBadge status={run.status} />
        {run.dryRun && <span className="badge bg-sky-200">dry run</span>}
        <span className="badge bg-white">{run.mode} mode</span>
        <span className="text-sm">started {formatTime(run.startedAt)}</span>
        {live && <span className="text-sm font-bold">● live, refreshing every 2 s</span>}
        {error && <span className="text-sm text-red-700">({error})</span>}
        <a href={liveUrl} target="_blank" rel="noreferrer" className="ml-auto underline">
          MCP live view ↗
        </a>
      </div>
      <div className="mb-6 flex flex-wrap gap-4">
        <Stat label="steps verified" value={`${passed}/${tool?.steps.length ?? run.trace.length}`} />
        <Stat label="deterministic checks" value={checks} />
        <Stat label="model calls in the engine" value={0} />
        <Stat label="elapsed" value={<span suppressHydrationWarning>{formatDuration(runDurationMs(run))}</span>} />
      </div>
      <NeedPanel detail={data} />
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card title="Step timeline">
          {tool ? (
            <RunTimeline entries={entries} blobHref={(id) => `/api/blobs/${encodeURIComponent(id)}`} />
          ) : (
            <p>Tool definition not available; {run.trace.length} trace entries recorded.</p>
          )}
        </Card>
        <div className="space-y-6">
          {Object.keys(run.outputs).length > 0 && (
            <section className="card bg-green-200">
              <h2 className="mb-2 text-xl">Outputs</h2>
              <KeyValues entries={Object.entries(run.outputs).map(([k, v]) => [k, <b key={k} className="text-xl">{v}</b>])} />
            </section>
          )}
          {run.receiptId && (
            <Card title="Signed receipt">
              <Link href={`/receipts/${run.receiptId}`} className="btn btn-primary no-underline">
                View receipt {run.receiptId} →
              </Link>
            </Card>
          )}
          <Card title="Inputs (redacted)">
            <KeyValues entries={Object.entries(run.inputsRedacted)} />
          </Card>
          {live && (
            <Card title="Stop this run">
              <ActionForm action={cancelRun} hidden={{ id: run.id }} label="Cancel run" variant="btn-danger" confirm="Cancel this run?" />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
