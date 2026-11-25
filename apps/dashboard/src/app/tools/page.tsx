import Link from "next/link";
import { EmptyState, PageHeader, StatusBadge } from "../../components/ui";
import { formatTime } from "../../lib/format";
import { requestSource } from "../../lib/server";

export default async function ToolsPage({ searchParams }: { searchParams: Promise<{ site?: string }> }) {
  const { site } = await searchParams;
  const { client } = await requestSource();
  const [tools, sites] = await Promise.all([client.listTools(site ? { siteId: site } : {}), client.listSites()]);
  const siteName = new Map(sites.map((s) => [s.id, s]));
  return (
    <>
      <PageHeader title="Tools" subtitle="Latest version of every tool. Open one to review its step contracts." />
      <form className="mb-5 flex flex-wrap items-center gap-3">
        <label className="font-bold" htmlFor="site">
          Site
        </label>
        <select id="site" name="site" defaultValue={site ?? ""} className="input">
          <option value="">All sites</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="btn">Filter</button>
      </form>
      {tools.length === 0 ? (
        <EmptyState title="No tools yet">
          Record a task on the <Link href="/record" className="underline">Record</Link> page and compile it into a draft tool.
        </EmptyState>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="tbl text-lg">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Site</th>
                <th>Version</th>
                <th>Status</th>
                <th>Steps</th>
                <th>Last updated</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/tools/${t.id}`} className="font-bold underline">
                      {t.title}
                    </Link>
                    <div className="font-mono text-sm">{t.name}</div>
                  </td>
                  <td>{siteName.get(t.siteId)?.slug ?? t.siteId}</td>
                  <td>v{t.version}</td>
                  <td>
                    <StatusBadge status={t.status} />
                  </td>
                  <td>{t.steps.length}</td>
                  <td className="whitespace-nowrap">{formatTime(t.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
