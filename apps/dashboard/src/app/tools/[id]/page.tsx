import Link from "next/link";
import type { Tool } from "@mcpify/contracts";
import { approveTool, disableTool } from "../../actions";
import { ActionForm } from "../../../components/ActionForm";
import { StepCard } from "../../../components/StepCard";
import { Card, JsonBlock, PageHeader, RiskBadge, StatusBadge } from "../../../components/ui";
import { changedStepIds, formatTime } from "../../../lib/format";
import { orNotFound, requestSource } from "../../../lib/server";
import type { ApiClient } from "../../../lib/api";

/** All versions 1..latest; the API has no list endpoint, so fetch each (tools have few versions). */
async function versionHistory(client: ApiClient, latest: Tool): Promise<Tool[]> {
  const nums = Array.from({ length: latest.version }, (_, i) => i + 1);
  const all = await Promise.all(nums.map((v) => (v === latest.version ? latest : client.getToolVersion(latest.id, v).catch(() => null))));
  return all.filter((t): t is Tool => t !== null);
}

export default async function ToolPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const [{ id }, { v }] = await Promise.all([params, searchParams]);
  const { client } = await requestSource();
  const latest = await orNotFound(client.getTool(id));
  const history = await versionHistory(client, latest);
  const shown = history.find((t) => String(t.version) === v) ?? latest;
  const prev = history.find((t) => t.version === shown.version - 1);
  const changed = new Set(prev ? changedStepIds(prev, shown) : []);
  const risks = (["read", "fill", "commit", "auth"] as const).map((r) => [r, shown.steps.filter((s) => s.risk === r).length] as const);

  return (
    <>
      <p className="mb-2">
        <Link href="/tools" className="underline">
          ← All tools
        </Link>
      </p>
      <PageHeader
        title={shown.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <code>{shown.name}</code> · v{shown.version} <StatusBadge status={shown.status} />
            {shown.version !== latest.version && <span className="badge bg-yellow-200">viewing old version</span>}
          </span>
        }
        actions={
          shown.version === latest.version && (
            <>
              <ActionForm action={approveTool} hidden={{ id }} label="Approve" variant="btn-primary" disabled={latest.status === "approved"} />
              <ActionForm
                action={disableTool}
                hidden={{ id }}
                label="Disable"
                variant="btn-danger"
                confirm="Disable this tool for all agents?"
                disabled={latest.status === "disabled"}
              />
            </>
          )
        }
      />
      <div className="mb-8 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="What agents see">
          <p className="text-lg">{shown.description}</p>
          <p className="mt-3">
            <span className="font-bold">Start URL:</span> <code className="break-all">{shown.startUrl}</code>
          </p>
          <p className="mt-1">
            <span className="font-bold">Outputs:</span> {shown.outputs.join(", ") || "none"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {risks.map(([r, n]) => (
              <span key={r} className="flex items-center gap-1">
                <RiskBadge risk={r} /> ×{n}
              </span>
            ))}
          </div>
          <JsonBlock value={shown.inputSchema} summary="Input schema" />
        </Card>
        <Card title="Version history">
          <ol className="space-y-2">
            {[...history].reverse().map((t) => (
              <li key={t.version}>
                <Link
                  href={`/tools/${id}?v=${t.version}`}
                  className={`block border-[3px] border-ink px-3 py-2 no-underline ${t.version === shown.version ? "bg-orange" : "bg-cream hover:bg-white"}`}
                >
                  <span className="font-bold">v{t.version}</span> · {formatTime(t.updatedAt)}
                  {t.version === latest.version && <span className="ml-2 badge bg-white">latest</span>}
                </Link>
              </li>
            ))}
          </ol>
          {prev && changed.size > 0 && (
            <p className="mt-3 text-sm">
              Changed since v{prev.version}: <b>{[...changed].join(", ")}</b>
            </p>
          )}
        </Card>
      </div>
      <h2 className="mb-4 text-2xl">Step contracts ({shown.steps.length})</h2>
      <div className="space-y-5">
        {shown.steps.map((s, i) => (
          <StepCard key={s.id} step={s} index={i} highlight={changed.has(s.id)} />
        ))}
      </div>
      <div className="mt-8">
        <Card title="Raw tool JSON">
          <JsonBlock value={shown} summary={`Show ${shown.name} v${shown.version} JSON`} />
        </Card>
      </div>
    </>
  );
}
