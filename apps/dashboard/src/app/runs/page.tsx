import { RunsLive } from "../../components/RunsLive";
import { PageHeader } from "../../components/ui";
import { listRunRows } from "../../lib/runs";
import { MCP_LIVE_URL, requestSource } from "../../lib/server";

export default async function RunsPage() {
  const { client } = await requestSource();
  const runs = await listRunRows(client);
  return (
    <>
      <PageHeader
        title="Runs"
        subtitle="Every tool call, checked step by step."
        actions={
          <a href={MCP_LIVE_URL} target="_blank" rel="noreferrer" className="btn btn-primary no-underline">
            Open MCP live view ↗
          </a>
        }
      />
      <RunsLive initial={runs} />
    </>
  );
}
