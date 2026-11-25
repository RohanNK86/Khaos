import Link from "next/link";
import { CopyButton } from "../../components/CopyButton";
import { Card, EmptyState, PageHeader, StatusBadge } from "../../components/ui";
import { scriptTag } from "../../lib/format";
import { publicApiUrl, requestSource } from "../../lib/server";

export default async function SitesPage() {
  const { client } = await requestSource();
  const [sites, tools] = await Promise.all([client.listSites(), client.listTools()]);
  const api = publicApiUrl();
  return (
    <>
      <PageHeader title="Sites" subtitle="Each site gets one script tag. Approved tools appear to agents automatically." />
      {sites.length === 0 ? (
        <EmptyState title="No sites yet">
          Register one with <code>POST /sites</code> or run the recorder against your portal.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {sites.map((site) => {
            const own = tools.filter((t) => t.siteId === site.id);
            const count = (s: string) => own.filter((t) => t.status === s).length;
            const tag = scriptTag(api, site.slug);
            return (
              <Card
                key={site.id}
                title={
                  <span className="flex flex-wrap items-center gap-3">
                    {site.name} <StatusBadge status={site.mode} />
                  </span>
                }
              >
                <p className="mb-3">
                  <a href={site.origin} target="_blank" rel="noreferrer" className="font-bold underline">
                    {site.origin}
                  </a>{" "}
                  · slug <code className="font-bold">{site.slug}</code>
                </p>
                <div className="mb-4 flex flex-wrap gap-3">
                  <Link href={`/tools?site=${site.id}`} className="badge bg-green-300 py-1 text-base">
                    {count("approved")} approved
                  </Link>
                  <Link href={`/tools?site=${site.id}`} className="badge bg-yellow-200 py-1 text-base">
                    {count("draft")} draft
                  </Link>
                  {count("disabled") > 0 && <span className="badge bg-neutral-300 py-1 text-base">{count("disabled")} disabled</span>}
                </div>
                <p className="mb-2 text-sm font-bold uppercase">Script tag</p>
                <pre className="code mb-3 whitespace-pre-wrap break-all">{tag}</pre>
                <CopyButton text={tag} label="Copy script tag" />
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
