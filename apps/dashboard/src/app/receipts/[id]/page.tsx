import Link from "next/link";
import { verifyReceipt } from "../../actions";
import { ActionForm } from "../../../components/ActionForm";
import { Card, JsonBlock, KeyValues, PageHeader } from "../../../components/ui";
import { formatTime } from "../../../lib/format";
import { orNotFound, requestSource } from "../../../lib/server";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { client } = await requestSource();
  const r = await orNotFound(client.getReceipt(id));
  return (
    <>
      <p className="mb-2">
        <Link href="/receipts" className="underline">
          ← All receipts
        </Link>
      </p>
      <PageHeader
        title={`Receipt ${r.id}`}
        subtitle={`Issued ${formatTime(r.issuedAt)} · ${r.siteOrigin}`}
        actions={<ActionForm action={verifyReceipt} hidden={{ id: r.id }} label="Verify signature" variant="btn-primary" />}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card bg-green-200">
          <h2 className="mb-2 text-xl">Outputs</h2>
          <KeyValues entries={Object.entries(r.outputs).map(([k, v]) => [k, <b key={k} className="text-2xl">{v}</b>])} />
        </section>
        <Card title="Submitted (redacted)">
          <KeyValues entries={r.summary.map((s) => [s.label, s.value])} />
        </Card>
        <Card title="Proof" className="lg:col-span-2">
          <KeyValues
            entries={[
              ["Run", <Link key="run" href={`/runs/${r.runId}`} className="underline">{r.runId}</Link>],
              ["Tool", <Link key="tool" href={`/tools/${r.toolId}?v=${r.toolVersion}`} className="underline">{`${r.toolId} v${r.toolVersion}`}</Link>],
              ["Trace hash (sha256)", <code key="h">{r.traceHash}</code>],
              ["Key id", <code key="k">{r.keyId}</code>],
              ["Signature", <code key="s">{r.signature}</code>],
            ]}
          />
          <JsonBlock value={r} summary="Raw receipt JSON" />
        </Card>
      </div>
    </>
  );
}
