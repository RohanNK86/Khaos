import Link from "next/link";
import { RunLive } from "../../../components/RunLive";
import { PageHeader } from "../../../components/ui";
import { getRunDetail } from "../../../lib/runs";
import { MCP_LIVE_URL, orNotFound, requestSource } from "../../../lib/server";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { client } = await requestSource();
  const detail = await orNotFound(getRunDetail(client, id));
  return (
    <>
      <p className="mb-2">
        <Link href="/runs" className="underline">
          ← All runs
        </Link>
      </p>
      <PageHeader
        title={detail.tool?.title ?? "Run"}
        subtitle={
          <span className="font-mono text-base">
            {detail.tool?.name} v{detail.run.toolVersion} · run {detail.run.id}
          </span>
        }
      />
      <RunLive initial={detail} liveUrl={MCP_LIVE_URL} />
    </>
  );
}
