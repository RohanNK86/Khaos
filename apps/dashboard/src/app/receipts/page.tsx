import Link from "next/link";
import { redirect } from "next/navigation";
import type { Receipt } from "@mcpify/contracts";
import { EmptyState, PageHeader } from "../../components/ui";
import { formatTime } from "../../lib/format";
import { requestSource } from "../../lib/server";

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  if (id?.trim()) redirect(`/receipts/${encodeURIComponent(id.trim())}`);
  const { client } = await requestSource();
  // No "list receipts" endpoint: receipts are found through the runs that produced them.
  const runs = await client.listRuns({ limit: 100 });
  const receipts = (
    await Promise.all(runs.filter((r) => r.receiptId).map((r) => client.getReceipt(r.receiptId ?? "").catch((): Receipt | null => null)))
  ).filter((r): r is Receipt => r !== null);
  return (
    <>
      <PageHeader title="Receipts" subtitle="Signed proof of what was submitted, by which tool version, with which verified trace." />
      <form className="mb-6 flex flex-wrap items-center gap-3">
        <input name="id" placeholder="Receipt id, e.g. rcpt-0001" className="input min-w-72" />
        <button className="btn">Open receipt</button>
      </form>
      {receipts.length === 0 ? (
        <EmptyState title="No receipts yet">A receipt is issued when a run with a commit step succeeds.</EmptyState>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="tbl text-lg">
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Outputs</th>
                <th>Site</th>
                <th>Issued</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/receipts/${r.id}`} className="font-bold underline">
                      {r.id}
                    </Link>
                  </td>
                  <td>
                    {Object.entries(r.outputs).map(([k, v]) => (
                      <div key={k}>
                        {k}: <b>{v}</b>
                      </div>
                    ))}
                  </td>
                  <td>{r.siteOrigin}</td>
                  <td className="whitespace-nowrap">{formatTime(r.issuedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
