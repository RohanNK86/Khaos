// Builds dist/mcpify.js: one IIFE with the engine core, the DomDriver and the WebMCP adapter.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/** Read IN_PAGE_JS from the engine so the bundle can inline it as code (no eval: CSP-safe). */
export async function inPageSource() {
  const file = createRequire(import.meta.url).resolve("@mcpify/engine/in-page");
  const out = await build({ entryPoints: [file], format: "esm", write: false, logLevel: "silent" });
  const mod = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
  return mod.IN_PAGE_JS;
}

/** esbuild plugin: `import { installInPage } from "mcpify:in-page"`. */
export function inPagePlugin(src) {
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

export async function buildMcpifyJs({ minify = true, outfile = fileURLToPath(new URL("./dist/mcpify.js", import.meta.url)) } = {}) {
  await build({
    entryPoints: [fileURLToPath(new URL("./src/main.ts", import.meta.url))],
    outfile,
    bundle: true, format: "iife", platform: "browser", target: "chrome120", minify, sourcemap: false,
    plugins: [inPagePlugin(await inPageSource())],
    logLevel: "warning",
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await buildMcpifyJs();
