import type { FastifyInstance } from "fastify";
import type { Ctx } from "../context.js";
import { HttpError, found, parse } from "../http.js";
import { z } from "zod";

const BLOB_LIMIT = 25 * 1024 * 1024;

/** Raw blobs (DOM snapshots, screenshots). Encapsulated so any content type arrives as a Buffer. */
export async function blobRoutes(app: FastifyInstance, { blobs }: Ctx): Promise<void> {
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: BLOB_LIMIT }, (_req, body, done) => done(null, body));

    scope.post("/blobs", async (req) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, "send the blob as the raw request body");
      const mime = (req.headers["content-type"] ?? "application/octet-stream").split(";")[0]!.trim();
      return { blobId: await blobs.put(req.body, mime) };
    });

    scope.get("/blobs/:blobId", async (req, reply) => {
      const { blobId } = parse(z.object({ blobId: z.string().min(1) }), req.params, "params");
      const blob = found((await blobs.get(blobId)) ?? undefined, `blob ${blobId}`);
      return reply.type(blob.mime).send(blob.content);
    });
  });
}
