import { ApiError } from "../../../../lib/api";
import { getRunDetail } from "../../../../lib/runs";
import { errorMessage, requestSource } from "../../../../lib/server";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const { client } = await requestSource();
    return Response.json(await getRunDetail(client, id));
  } catch (e) {
    return Response.json({ error: errorMessage(e) }, { status: e instanceof ApiError ? e.status : 502 });
  }
}
