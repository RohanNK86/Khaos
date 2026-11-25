import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { FileBlob } from "@mcpify/engine";
import { HttpError } from "../http.js";
import { p } from "../paths.js";

const MIME: [RegExp, string][] = [
  [/\.pdf$/i, "application/pdf"],
  [/\.jpe?g$/i, "image/jpeg"],
  [/\.png$/i, "image/png"],
];

/** Upload params are plain file names from fixtures/files (the demo "file store"); only the basename is used. */
export async function loadFile(ref: string): Promise<FileBlob> {
  const name = basename(ref);
  try {
    const bytes = await readFile(p("fixtures/files", name));
    return { name, mime: MIME.find(([re]) => re.test(name))?.[1] ?? "application/octet-stream", bytes };
  } catch {
    throw new HttpError(400, `file ${name} is not in the MCPify file store`);
  }
}
