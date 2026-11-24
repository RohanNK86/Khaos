import express, { type Request, type Response, type NextFunction, type Router } from "express";
import { esc } from "./html.js";

export interface LabTarget {
  mutations: Set<string>;
  knownMutations: Record<string, string>;
  state(): unknown;
  reset(): void;
  otpFor(session: string): string | undefined;
  captchaFor(session: string): string | undefined;
}

export const labToken = () => process.env.LAB_TOKEN ?? "changeme";

function requireToken(req: Request, res: Response, next: NextFunction) {
  if (req.header("x-lab-token") !== labToken()) {
    res.status(401).json({ error: "missing or wrong x-lab-token" });
    return;
  }
  next();
}

/** Layout Lab + test hooks (01-CONTRACTS §14). */
export function labRouter(t: LabTarget): Router {
  const r = express.Router();
  r.use(express.json());

  r.get("/__lab", (_req, res) => {
    const rows = Object.entries(t.knownMutations)
      .map(([id, d]) => `<label style="display:block;margin:6px 0"><input type="checkbox" data-m="${id}"/> <b>${id}</b> ${esc(d)}</label>`)
      .join("");
    res.type("html").send(`<!doctype html><title>Layout Lab</title>
<body style="font-family:system-ui;max-width:640px;margin:30px auto;background:#F8F2E4">
<h1 style="font-family:'Archivo Black',system-ui">Layout Lab</h1>
<p>Change the portal's layout live, then run the MCPify tool again.</p>
<p>Lab token: <input id="tok" value="changeme"/></p>${rows}
<p><button id="reset">Reset portal (clears applications)</button> <span id="msg"></span></p>
<script>
const tok=document.getElementById('tok');tok.value=localStorage.labToken||tok.value;tok.onchange=()=>{localStorage.labToken=tok.value;load()};
const call=(p,o={})=>fetch(p,{...o,headers:{'content-type':'application/json','x-lab-token':tok.value}}).then(r=>r.json());
async function load(){const s=await call('/__lab/state');if(s.error){msg.textContent=s.error;return}msg.textContent='';
document.querySelectorAll('[data-m]').forEach(c=>c.checked=s.mutations.includes(c.dataset.m));}
document.querySelectorAll('[data-m]').forEach(c=>c.onchange=()=>call('/__lab/mutations',{method:'POST',body:JSON.stringify(c.checked?{enable:[c.dataset.m],disable:[]}:{enable:[],disable:[c.dataset.m]})}).then(load));
document.getElementById('reset').onclick=()=>call('/__lab/reset',{method:'POST'}).then(()=>{msg.textContent='Reset done';load()});
load();
</script></body>`);
  });

  r.get("/__lab/state", requireToken, (_req, res) => res.json(t.state()));
  r.post("/__lab/mutations", requireToken, (req, res) => {
    const body = (req.body ?? {}) as { enable?: string[]; disable?: string[] };
    for (const m of body.enable ?? []) if (m in t.knownMutations) t.mutations.add(m);
    for (const m of body.disable ?? []) t.mutations.delete(m);
    res.json({ mutations: [...t.mutations] });
  });
  r.post("/__lab/reset", requireToken, (_req, res) => {
    t.reset();
    res.json({ ok: true });
  });
  r.get("/__lab/otp", requireToken, (req, res) => {
    const otp = t.otpFor(String(req.query.session ?? ""));
    if (!otp) res.status(404).json({ error: "no OTP for this session" });
    else res.json({ otp });
  });
  r.get("/__lab/captcha", requireToken, (req, res) => {
    const captcha = t.captchaFor(String(req.query.session ?? ""));
    if (!captcha) res.status(404).json({ error: "no CAPTCHA for this session" });
    else res.json({ captcha });
  });
  return r;
}
