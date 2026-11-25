import type { Need } from "@mcpify/contracts";
import type { FileBlob, NeedAnswer } from "@mcpify/engine";

/** How a run talks to the human on the page. */
export interface PauseUi {
  onNeed(need: Need, toolTitle: string): Promise<NeedAnswer>;
  pickFile(ref: string): Promise<FileBlob>;
  /** Small status pill; null hides it. */
  status(text: string | null): void;
}

const CSS = `
:host{all:initial}
.wrap{position:fixed;inset:0;background:rgba(26,26,26,.35);display:flex;align-items:center;justify-content:center;z-index:2147483646;font-family:"Space Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif;color:#1A1A1A}
.card{background:#F8F2E4;border:3px solid #1A1A1A;box-shadow:6px 6px 0 #1A1A1A;border-radius:10px;width:min(420px,calc(100vw - 32px));padding:18px 20px;box-sizing:border-box}
.tag{display:inline-block;background:#FD9B36;border:2px solid #1A1A1A;border-radius:6px;padding:2px 8px;font-weight:800;font-size:12px;letter-spacing:.04em}
h2{font-family:"Archivo Black","Arial Black",system-ui,sans-serif;font-size:19px;margin:10px 0 6px}
p{margin:6px 0 10px;font-size:14px;line-height:1.4}
dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:8px 0 14px;font-size:13px;max-height:40vh;overflow:auto}
dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}
input{width:100%;box-sizing:border-box;padding:9px 10px;border:2px solid #1A1A1A;border-radius:6px;font:inherit;font-size:16px;background:#fff;margin-bottom:12px}
.row{display:flex;gap:10px;justify-content:flex-end}
button{font:inherit;font-weight:800;border:2px solid #1A1A1A;border-radius:6px;padding:8px 14px;cursor:pointer;box-shadow:3px 3px 0 #1A1A1A;background:#fff;color:#1A1A1A}
button.go{background:#FD9B36}
button:active{transform:translate(2px,2px);box-shadow:1px 1px 0 #1A1A1A}
.pill{position:fixed;right:16px;bottom:16px;z-index:2147483645;background:#F8F2E4;border:2px solid #1A1A1A;box-shadow:3px 3px 0 #1A1A1A;border-radius:8px;padding:6px 10px;font:600 13px "Space Grotesk",system-ui,sans-serif;color:#1A1A1A;max-width:min(360px,calc(100vw - 32px))}
`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** In-page modal in MCPify style, isolated from the site's CSS in a shadow root. */
export function createPauseUi(doc: Document): PauseUi {
  let root: ShadowRoot | null = null;
  const shadow = () => {
    if (root) return root;
    const host = doc.createElement("mcpify-ui");
    host.setAttribute("data-mcpify-ui", "");
    doc.documentElement.appendChild(host);
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}</style><div class="pill" hidden></div><div class="slot"></div>`;
    return root;
  };
  const show = (html: string) => {
    const slot = shadow().querySelector(".slot")!;
    slot.innerHTML = `<div class="wrap" role="dialog" aria-modal="true"><div class="card">${html}</div></div>`;
    return slot;
  };
  const close = () => { shadow().querySelector(".slot")!.innerHTML = ""; };

  return {
    onNeed(need, toolTitle) {
      return new Promise((resolve) => {
        if (need.kind === "confirmation") {
          const rows = need.preview.map((p) => `<dt>${esc(p.label)}</dt><dd>${esc(p.value)}</dd>`).join("");
          const slot = show(`<span class="tag">MCPify · confirm</span><h2>${esc(toolTitle)}</h2>
<p>The next step <b>sends data</b> to this website. Please check the details.</p><dl>${rows}</dl>
<div class="row"><button data-act="no">Cancel</button><button class="go" data-act="yes">Confirm and send</button></div>`);
          slot.querySelector("[data-act=yes]")!.addEventListener("click", () => { close(); resolve({ approve: true }); });
          slot.querySelector("[data-act=no]")!.addEventListener("click", () => { close(); resolve({ approve: false }); });
          return;
        }
        const slot = show(`<span class="tag">MCPify · your input</span><h2>${esc(toolTitle)}</h2><p>${esc(need.prompt)}</p>
<form><input name="v" type="${need.sensitive ? "password" : "text"}" autocomplete="one-time-code" aria-label="${esc(need.param)}" required/>
<div class="row"><button type="button" data-act="no">Cancel</button><button class="go" type="submit">Continue</button></div></form>`);
        const form = slot.querySelector("form")!;
        const input = form.querySelector("input")!;
        input.focus();
        form.addEventListener("submit", (e) => { e.preventDefault(); const value = input.value; close(); resolve({ value }); });
        slot.querySelector("[data-act=no]")!.addEventListener("click", () => { close(); resolve({}); });
      });
    },
    pickFile(ref) {
      return new Promise((resolve, reject) => {
        const slot = show(`<span class="tag">MCPify · upload</span><h2>Choose a file</h2><p>The form needs <b>${esc(ref)}</b>. Pick it from your device.</p>
<input type="file"/><div class="row"><button data-act="no">Cancel</button></div>`);
        const input = slot.querySelector("input")!;
        input.addEventListener("change", async () => {
          const f = input.files?.[0];
          close();
          if (!f) return reject(new Error("no file chosen"));
          resolve({ name: f.name, mime: f.type || "application/octet-stream", bytes: new Uint8Array(await f.arrayBuffer()) });
        });
        slot.querySelector("[data-act=no]")!.addEventListener("click", () => { close(); reject(new Error("no file chosen")); });
      });
    },
    status(text) {
      const pill = shadow().querySelector<HTMLElement>(".pill")!;
      pill.hidden = text === null;
      pill.textContent = text ? `MCPify · ${text}` : "";
    },
  };
}
