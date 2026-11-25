import Link from "next/link";
import { Card, Stat } from "../components/ui";
import { requestSource } from "../lib/server";

export default async function Home() {
  const { client } = await requestSource();
  const [sites, tools, runs, pending] = await Promise.all([
    client.listSites(),
    client.listTools(),
    client.listRuns({ limit: 50 }),
    client.listRepairs("pending"),
  ]);
  const approved = tools.filter((t) => t.status === "approved").length;
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-5xl">Your site, agent-ready.</h1>
        <p className="mt-2 max-w-3xl text-xl">
          Record a task once, approve the verified tool, and every agent call is checked step by step, paused for the
          human on OTP and submit, and signed with a receipt.
        </p>
      </div>
      <div className="flex flex-wrap gap-4">
        <Stat label="sites" value={sites.length} />
        <Stat label="approved tools" value={approved} />
        <Stat label="draft tools" value={tools.filter((t) => t.status === "draft").length} />
        <Stat label="recent runs" value={runs.length} />
        <Stat label="repairs to review" value={pending.length} />
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {[
          ["/record", "1 · Record", "Show MCPify the task once in a real browser."],
          ["/tools", "2 · Approve", "Review each step contract, then approve the tool."],
          ["/runs", "3 · Watch", "Live runs, pauses for confirmation, receipts."],
        ].map(([href, title, text]) => (
          <Link key={href} href={href ?? "/"} className="no-underline">
            <Card title={title} className="h-full hover:bg-orange/30">
              <p className="text-lg">{text}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
