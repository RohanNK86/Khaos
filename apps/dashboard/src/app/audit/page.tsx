import Link from "next/link";
import { EmptyState, PageHeader } from "../../components/ui";
import { formatTime } from "../../lib/format";
import { lookups, requestSource } from "../../lib/server";

const ACTOR_CLASS: Record<string, string> = {
  agent: "bg-sky-200",
  user: "bg-green-300",
  owner: "bg-orange",
  system: "bg-neutral-200",
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const { site } = await searchParams;
  const source = await requestSource();
  const [events, { tools, sites }] = await Promise.all([
    source.client.listAudit({ siteId: site || undefined, limit: 200 }),
    lookups(source),
  ]);
  return (
    <>
      <PageHeader title="Audit log" subtitle="Who did what: agents, users, owners and the system." />
      <form className="mb-5 flex flex-wrap items-center gap-3">
        <label htmlFor="site" className="font-bold">
          Site
        </label>
        <select id="site" name="site" defaultValue={site ?? ""} className="input">
          <option value="">All sites</option>
          {[...sites.values()].map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="btn">Filter</button>
      </form>
      {events.length === 0 ? (
        <EmptyState title="No audit events" />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="tbl text-lg">
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Site</th>
                <th>Tool / run</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{formatTime(e.at)}</td>
                  <td>
                    <span className={`badge ${ACTOR_CLASS[e.actor] ?? "bg-white"}`}>{e.actor}</span>
                  </td>
                  <td className="font-mono text-base">{e.action}</td>
                  <td>{sites.get(e.siteId)?.slug ?? e.siteId}</td>
                  <td>
                    {e.toolId && (
                      <Link href={`/tools/${e.toolId}`} className="underline">
                        {tools.get(e.toolId)?.name ?? e.toolId}
                      </Link>
                    )}
                    {e.runId && (
                      <div>
                        <Link href={`/runs/${e.runId}`} className="text-sm underline">
                          run {e.runId}
                        </Link>
                      </div>
                    )}
                  </td>
                  <td>{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
