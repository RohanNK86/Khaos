// Builds the unpacked MV3 extension into dist/ (or another outdir for tests).
import { build } from "esbuild";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/** IN_PAGE_JS from the engine, inlined into the content script as code (no eval). */
async function inPageSource() {
  const file = createRequire(import.meta.url).resolve("@mcpify/engine/in-page");
  const out = await build({ entryPoints: [file], format: "esm", write: false, logLevel: "silent" });
  const mod = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
  return mod.IN_PAGE_JS;
}

function inPagePlugin(src) {
  return {
    name: "mcpify-in-page",
    setup(b) {
      b.onResolve({ filter: /^mcpify:in-page$/ }, () => ({ path: "in-page", namespace: "mcpify" }));
      b.onLoad({ filter: /.*/, namespace: "mcpify" }, () => ({
        contents: `export const installInPage = (window) => { const document = window.document; return ${src}; };`,
        loader: "js",
      }));
    },
  };
}

/**
 * @param {{ outdir?: string, extraDemoOrigins?: string[], minify?: boolean }} opts
 * extraDemoOrigins is for test builds only (lets a random-port test portal count as a demo origin).
 */
export async function buildExtension({ outdir = here("./dist"), extraDemoOrigins = [], minify = true } = {}) {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(join(outdir, "files"), { recursive: true });
  await build({
    entryPoints: { background: here("./src/background.ts"), sidepanel: here("./src/sidepanel.ts"), content: here("./src/content.ts") },
    outdir, bundle: true, format: "iife", platform: "browser", target: "chrome120", minify, sourcemap: false,
    define: { __MCPIFY_EXTRA_DEMO_ORIGINS__: JSON.stringify(extraDemoOrigins) },
    plugins: [inPagePlugin(await inPageSource())],
    logLevel: "warning",
  });
  for (const f of ["manifest.json", "sidepanel.html", "sidepanel.css"]) await copyFile(here(`./static/${f}`), join(outdir, f));
  // Demo sample files for upload steps (fixtures/files): no personal data.
  const files = here("../../fixtures/files/");
  for (const f of await readdir(files)) await copyFile(join(files, f), join(outdir, "files", f));
  return outdir;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(`built ${await buildExtension()}`);
