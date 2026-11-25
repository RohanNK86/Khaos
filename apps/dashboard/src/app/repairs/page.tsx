import Link from "next/link";
import type { RepairProposal, StepContract, Tool } from "@mcpify/contracts";
import { approveRepair, rejectRepair } from "../actions";
import { ActionForm } from "../../components/ActionForm";
import { StepDiff } from "../../components/StepDiff";
import { EmptyState, PageHeader, RiskBadge, StatusBadge } from "../../components/ui";
import type { ApiClient } from "../../lib/api";
import { formatTime, humanize, percent } from "../../lib/format";
import { requestSource } from "../../lib/server";

interface Row {
  p: RepairProposal;
  tool?: Tool;
  oldStep?: StepContract;
}

async function enrich(client: ApiClient, proposals: RepairProposal[]): Promise<Row[]> {
  return Promise.all(
    proposals.map(async (p) => {
      const tool = await client.getToolVersion(p.toolId, p.fromVersion).catch(() => undefined);
      return { p, tool, oldStep: tool?.steps.find((s) => s.id === p.stepId) };
    }),
  );
}

function Proposal({ row, actions }: { row: Row; actions: boolean }) {
  const { p, tool, oldStep } = row;
  return (
    <article className="card">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="text-xl">
          {tool ? (
            <Link href={`/tools/${p.toolId}`} className="underline">
              {tool.name}
            </Link>
          ) : (
            p.toolId
          )}{" "}
          · <code>{p.stepId}</code>
        </h3>
        <RiskBadge risk={p.proposedStep.risk} />
        <StatusBadge status={p.status} />
        <span className="badge bg-white">from v{p.fromVersion}</span>
        <span className="ml-auto text-sm">{formatTime(p.createdAt)}</span>
      </header>
      <p className="mb-3 text-lg">
        <b>Why:</b> {p.reason}
      </p>
      <div className="mb-4 grid gap-4 md:grid-cols-3">
        <div className="border-[3px] border-ink bg-cream p-3">
          <p className="text-sm font-bold uppercase">Evidence</p>
          <ul className="list-inside list-disc">
            {p.evidence.failedChecks.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <a href={`/api/blobs/${encodeURIComponent(p.evidence.domSnapshotBlobId)}`} target="_blank" rel="noreferrer" className="underline">
            DOM snapshot ↗
          </a>
          {p.evidence.screenshotBlobId && (
            <>
              {" · "}
              <a href={`/api/blobs/${encodeURIComponent(p.evidence.screenshotBlobId)}`} target="_blank" rel="noreferrer" className="underline">
                screenshot ↗
              </a>
            </>
          )}
        </div>
        <div className={`border-[3px] border-ink p-3 ${p.sandbox.passed ? "bg-green-200" : "bg-red-200"}`}>
          <p className="text-sm font-bold uppercase">Sandbox replay</p>
          <p className="font-bold">{p.sandbox.passed ? "✅ passed" : "❌ failed"}</p>
          <p>{p.sandbox.detail}</p>
        </div>
        <div className="border-[3px] border-ink bg-white p-3">
          <p className="text-sm font-bold uppercase">Confidence</p>
          <p className="font-display text-3xl">{percent(p.confidence)}</p>
          <p>
            method: {humanize(p.method)} · {p.reversible ? "reversible" : "not reversible"}
          </p>
        </div>
      </div>
      <StepDiff before={oldStep} after={p.proposedStep} />
      {actions && (
        <div className="mt-4 flex flex-wrap gap-4">
          <ActionForm action={approveRepair} hidden={{ id: p.id }} label="Approve patch" variant="btn-primary" />
          <ActionForm action={rejectRepair} hidden={{ id: p.id }} label="Reject" variant="btn-danger" />
        </div>
      )}
    </article>
  );
}

function Section({ title, rows, actions, empty }: { title: string; rows: Row[]; actions?: boolean; empty: string }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-2xl">
        {title} ({rows.length})
      </h2>
      {rows.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <div className="space-y-6">
          {rows.map((r) => (
            <Proposal key={r.p.id} row={r} actions={!!actions} />
          ))}
        </div>
      )}
    </section>
  );
}

export default async function RepairsPage() {
  const { client } = await requestSource();
  const rows = await enrich(client, await client.listRepairs());
  const by = (...s: RepairProposal["status"][]) => rows.filter((r) => s.includes(r.p.status));
  return (
    <>
      <PageHeader
        title="Repairs"
        subtitle="When a step's checks fail, MCPify proposes a verified fix. Read/fill fixes with ≥80% confidence apply themselves; commit and auth steps always wait for you."
      />
      <Section title="Waiting for your review" rows={by("pending")} actions empty="Nothing to review" />
      <Section title="Auto-applied" rows={by("auto_applied")} empty="No automatic repairs yet" />
      <Section title="Needs re-recording" rows={by("needs_rerecord")} empty="No structural changes detected" />
      <Section title="Decided" rows={by("approved", "rejected")} empty="No decisions yet" />
    </>
  );
}
