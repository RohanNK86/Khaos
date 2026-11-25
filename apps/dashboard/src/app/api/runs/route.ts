import { listRunRows } from "../../../lib/runs";
import { errorMessage, requestSource } from "../../../lib/server";

export async function GET() {
  try {
    const { client, mock } = await requestSource();
    return Response.json({ mock, runs: await listRunRows(client) });
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: 502 });
  }
}
