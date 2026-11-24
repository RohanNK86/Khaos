import express, { type Request, type Response } from "express";
import multer from "multer";
import { attrs, esc, page } from "../shared/html.js";
import { labRouter } from "../shared/lab.js";
import { SessionStore, type SessionData } from "../shared/session.js";
import {
  DECLARATION, MUTATIONS, PREFIX_ID, PREFIX_NAME, page1Fields, page2Fields, validate, type Field,
} from "./fields.js";

const PORTAL = "State Scholarship Portal (DEMO)";
const TAGLINE = "Department of Student Welfare (fictional) · Post-Matric Scholarship 2026-27";
const OTP_TTL_MS = 5 * 60 * 1000;

interface Application {
  applicationId: string;
  submittedAt: string;
  personal: Record<string, string>;
  academic: Record<string, string>;
  certificate: { name: string; size: number };
  status: string;
}
interface Sms { to: string; text: string; at: string }

interface Ctx { s: SessionData; m: Set<string>; owner: boolean }

export function createScholarshipPortal(opts: { apiUrl?: string } = {}) {
  const app = express();
  const sessions = new SessionStore();
  const mutations = new Set<string>();
  let applications: Application[] = [];
  let sms: Sms[] = [];
  let nextId = 123;
  const apiUrl = opts.apiUrl ?? process.env.API_URL ?? "http://localhost:4000";
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

  app.disable("x-powered-by");
  app.use(labRouter({
    mutations,
    knownMutations: MUTATIONS,
    state: () => ({ mutations: [...mutations], applications }),
    reset: () => { applications = []; sms = []; nextId = 123; mutations.clear(); sessions.clear(); },
    otpFor: (sid) => (sessions.get(sid)?.otp as { code: string } | undefined)?.code,
    captchaFor: (sid) => sessions.get(sid)?.captcha as string | undefined,
  }));
  app.use(sessions.middleware());
  app.use(express.urlencoded({ extended: false }));

  const ctx = (req: Request, res: Response): Ctx => {
    const s = res.locals.session as SessionData;
    if (req.query.owner === "1") s.owner = true;
    if (req.query.owner === "0") s.owner = false;
    return { s, m: mutations, owner: process.env.OWNER_MODE === "1" || s.owner === true };
  };

  // ── rendering helpers ──────────────────────────────────────────────────────
  const mc = (c: Ctx, key: string) => (c.owner ? key : undefined);
  const cls = (c: Ctx, name: string) => (c.m.has("M10") ? `${name}_x${name.length}q7` : name);
  const render = (c: Ctx, title: string, body: string) => {
    let html = page({
      portalName: PORTAL, tagline: TAGLINE, title, body,
      extraHead: c.owner ? `<script src="${esc(apiUrl)}/static/mcpify.js" data-site="scholarship" defer></script>` : "",
    });
    if (c.m.has("M10")) {
      for (const n of ["lbl", "frm", "sec", "btn", "req", "error", "info", "captcha"]) {
        html = html.replaceAll(`.${n}{`, `.${cls(c, n)}{`).replaceAll(`.${n},`, `.${cls(c, n)},`);
      }
    }
    return html;
  };
  const btnText = (c: Ctx) => (c.m.has("M7") ? "Continue" : "Next");
  const errSpan = (c: Ctx, f: { ctl: string }, err?: string) =>
    err ? `<span class="${cls(c, "error")}" id="${PREFIX_ID}${f.ctl}_err">${esc(err)}</span>` : "";

  function control(c: Ctx, f: Field, value: string): string {
    const base = { id: PREFIX_ID + f.ctl, name: PREFIX_NAME + f.ctl, "data-mcpify": mc(c, f.key) };
    if (f.kind === "select") {
      const opts = [`<option value="0">--Select--</option>`, ...(f.options ?? []).map(
        (o) => `<option ${attrs({ value: o.value, selected: o.value === value })}>${esc(o.label)}</option>`)];
      return `<select ${attrs(base)}>${opts.join("")}</select>`;
    }
    return `<input ${attrs({ ...base, type: f.kind, value, maxlength: f.kind === "text" ? 60 : undefined })}/>`;
  }

  /** Page 1 uses legacy table-cell labels; page 2 uses <label for>. */
  function rows(c: Ctx, fields: Field[], values: Record<string, string>, errors: Record<string, string>, useLabelFor: boolean) {
    return fields.map((f) => {
      const label = useLabelFor ? `<label for="${PREFIX_ID + f.ctl}">${esc(f.label)}</label>` : esc(f.label);
      return `<tr><td class="${cls(c, "lbl")}">${label} <span class="${cls(c, "req")}">*</span></td><td>${control(c, f, values[f.key] ?? "")}${errSpan(c, f, errors[f.key])}</td></tr>`;
    }).join("");
  }

  const read = (fields: Field[], body: Record<string, string>) =>
    Object.fromEntries(fields.map((f) => [f.key, (body[PREFIX_NAME + f.ctl] ?? "").trim()]));
  const labelOf = (f: Field, v: string) => f.options?.find((o) => o.value === v)?.label ?? v;

  // ── pages ──────────────────────────────────────────────────────────────────
  app.get("/", (req, res) => {
    const c = ctx(req, res);
    res.send(render(c, "Home", `
<div class="${cls(c, "sec")}">Welcome</div>
<p>Apply online for the Post-Matric Scholarship 2026-27. Keep your mobile phone and income certificate ready.</p>
<ul><li><a id="lnkNewApplication" href="/apply/1" ${attrs({ "data-mcpify": mc(c, "new_application") })}>New Scholarship Application</a></li>
<li><a id="lnkStatus" href="/status" ${attrs({ "data-mcpify": mc(c, "check_status") })}>Check Application Status</a></li></ul>
<p style="color:#555">Last date for submission: 31-12-2026. Helpdesk: 1800-000-0000 (fictional).</p>`));
  });

  function renderPage1(c: Ctx, values: Record<string, string>, errors: Record<string, string>) {
    return render(c, "Application - Step 1", `
<form method="post" action="/apply/1" id="aspnetForm" name="aspnetForm">
<div class="${cls(c, "sec")}">Step 1 of 3 : Personal Details</div>
<table class="${cls(c, "frm")}">${rows(c, page1Fields(c.m), values, errors, false)}</table>
<p><input type="submit" class="${cls(c, "btn")}" ${attrs({ id: PREFIX_ID + "btnNext1", name: PREFIX_NAME + "btnNext1", value: btnText(c), "data-mcpify": mc(c, "next_1") })}/></p>
</form>`);
  }

  app.get("/apply/1", (req, res) => {
    const c = ctx(req, res);
    res.send(renderPage1(c, (c.s.personal as Record<string, string>) ?? {}, {}));
  });
  app.post("/apply/1", (req, res) => {
    const c = ctx(req, res);
    const fields = page1Fields(c.m);
    const values = read(fields, req.body);
    const errors = validate(fields, req.body);
    if (Object.keys(errors).length) { res.send(renderPage1(c, values, errors)); return; }
    c.s.personal = values;
    c.s.personalLabels = Object.fromEntries(fields.map((f) => [f.label, labelOf(f, values[f.key]!)]));
    res.redirect(303, "/apply/2");
  });

  function renderPage2(c: Ctx, values: Record<string, string>, errors: Record<string, string>) {
    const table = `<table class="${cls(c, "frm")}">${rows(c, page2Fields(c.m), values, errors, true)}
<tr><td colspan="2"><input ${attrs({ type: "checkbox", id: PREFIX_ID + DECLARATION.ctl, name: PREFIX_NAME + DECLARATION.ctl, value: "on", checked: values.declaration === "on", "data-mcpify": mc(c, "declaration") })}/>
<label for="${PREFIX_ID + DECLARATION.ctl}">${DECLARATION.label}</label>${errSpan(c, DECLARATION, errors.declaration)}</td></tr></table>`;
    const wrapped = c.m.has("M5") ? `<div class="panel-outer"><table width="100%"><tr><td><div>${table}</div></td></tr></table></div>` : table;
    return render(c, "Application - Step 2", `
<form method="post" action="/apply/2" id="aspnetForm" name="aspnetForm">
<div class="${cls(c, "sec")}">Step 2 of 3 : Academic and Income Details</div>${wrapped}
<p><input type="submit" class="${cls(c, "btn")}" ${attrs({ id: PREFIX_ID + "btnNext2", name: PREFIX_NAME + "btnNext2", value: btnText(c), "data-mcpify": mc(c, "next_2") })}/></p>
</form>`);
  }

  app.get("/apply/2", (req, res) => {
    const c = ctx(req, res);
    if (!c.s.personal) { res.redirect(303, "/apply/1"); return; }
    res.send(renderPage2(c, (c.s.academic as Record<string, string>) ?? {}, {}));
  });
  app.post("/apply/2", (req, res) => {
    const c = ctx(req, res);
    if (!c.s.personal) { res.redirect(303, "/apply/1"); return; }
    const fields = page2Fields(c.m);
    const values: Record<string, string> = { ...read(fields, req.body), declaration: req.body[PREFIX_NAME + DECLARATION.ctl] === "on" ? "on" : "" };
    const errors = validate(fields, req.body);
    if (!values.declaration) errors.declaration = "You must accept the declaration";
    if (Object.keys(errors).length) { res.send(renderPage2(c, values, errors)); return; }
    c.s.academic = values;
    c.s.academicLabels = Object.fromEntries(fields.map((f) => [f.label, labelOf(f, values[f.key]!)]));
    res.redirect(303, "/apply/3");
  });

  function newCaptcha(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  }

  function renderPage3(c: Ctx, errors: Record<string, string>, info?: string) {
    const captcha = newCaptcha();
    c.s.captcha = captcha;
    const mobile = ((c.s.personal as Record<string, string>)?.mobile ?? "").slice(-4);
    const otpRows = `
<tr><td class="${cls(c, "lbl")}">Enter OTP <span class="${cls(c, "req")}">*</span></td><td><input ${attrs({ type: "text", id: PREFIX_ID + "txtOTP", name: PREFIX_NAME + "txtOTP", maxlength: 6, autocomplete: "off", "data-mcpify": mc(c, "otp") })}/>${errSpan(c, { ctl: "txtOTP" }, errors.otp)}</td></tr>
<tr><td class="${cls(c, "lbl")}">Type the characters shown <span class="${cls(c, "req")}">*</span></td><td><span class="${cls(c, "captcha")}" id="${PREFIX_ID}imgCaptcha">${captcha}</span><br/><br/><input ${attrs({ type: "text", id: PREFIX_ID + "txtCaptcha", name: PREFIX_NAME + "txtCaptcha", maxlength: 5, autocomplete: "off", "data-mcpify": mc(c, "captcha") })}/>${errSpan(c, { ctl: "txtCaptcha" }, errors.captcha)}</td></tr>`;
    const submitRow = `<tr><td colspan="2"><input type="submit" class="${cls(c, "btn")}" ${attrs({ id: PREFIX_ID + "btnSubmit", name: PREFIX_NAME + "btnSubmit", value: "Submit Application", "data-mcpify": mc(c, "submit_application") })}/></td></tr>`;
    return render(c, "Application - Step 3", `
<div class="${cls(c, "sec")}">Step 3 of 3 : Documents and Verification</div>
<form method="post" action="/apply/3/send-otp" id="frmOtp">
<table class="${cls(c, "frm")}"><tr><td class="${cls(c, "lbl")}">Mobile verification</td><td>An OTP will be sent to your registered mobile number ending <b>${esc(mobile)}</b>.<br/><br/>
<input type="submit" class="${cls(c, "btn")}" ${attrs({ id: PREFIX_ID + "btnSendOtp", name: PREFIX_NAME + "btnSendOtp", value: "Send OTP", "data-mcpify": mc(c, "send_otp") })}/>
${info ? `<br/><span class="${cls(c, "info")}" id="${PREFIX_ID}lblOtpMsg">${esc(info)}</span>` : ""}${errSpan(c, { ctl: "btnSendOtp" }, errors.send)}</td></tr></table></form>
<form method="post" action="/apply/3" enctype="multipart/form-data" id="aspnetForm" name="aspnetForm">
<table class="${cls(c, "frm")}">
<tr><td class="${cls(c, "lbl")}">Income Certificate (PDF/JPG, max 1 MB) <span class="${cls(c, "req")}">*</span></td><td><input ${attrs({ type: "file", id: PREFIX_ID + "fuIncomeCert", name: PREFIX_NAME + "fuIncomeCert", accept: ".pdf,.jpg,.jpeg", "data-mcpify": mc(c, "income_certificate") })}/>${errSpan(c, { ctl: "fuIncomeCert" }, errors.file)}</td></tr>
${c.m.has("M3") ? submitRow + otpRows : otpRows + submitRow}
</table></form>`);
  }

  app.get("/apply/3", (req, res) => {
    const c = ctx(req, res);
    if (!c.s.academic) { res.redirect(303, c.s.personal ? "/apply/2" : "/apply/1"); return; }
    const otp = c.s.otp as { exp: number } | undefined;
    const info = otp && otp.exp > Date.now() ? "OTP has been sent to your registered mobile number. It is valid for 5 minutes." : undefined;
    res.send(renderPage3(c, {}, info));
  });

  app.post("/apply/3/send-otp", (req, res) => {
    const c = ctx(req, res);
    if (!c.s.academic) { res.redirect(303, "/apply/1"); return; }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    c.s.otp = { code, exp: Date.now() + OTP_TTL_MS };
    const to = (c.s.personal as Record<string, string>).mobile!;
    sms.unshift({ to, text: `${code} is your OTP for ${PORTAL}. Valid for 5 minutes. Do not share it with anyone.`, at: new Date().toISOString() });
    console.log(`[portal:scholarship] OTP for ******${to.slice(-4)}: ${code}`);
    res.redirect(303, "/apply/3");
  });

  app.post("/apply/3", upload.single(PREFIX_NAME + "fuIncomeCert"), (req, res) => {
    const c = ctx(req, res);
    if (!c.s.academic) { res.redirect(303, "/apply/1"); return; }
    const body = req.body as Record<string, string>;
    const errors: Record<string, string> = {};
    const file = req.file;
    if (!file) errors.file = "Please upload the income certificate";
    else if (!/\.(pdf|jpe?g)$/i.test(file.originalname)) errors.file = "Only PDF or JPG files are allowed";
    else if (file.size > 1024 * 1024) errors.file = "File must be 1 MB or smaller";
    const otp = c.s.otp as { code: string; exp: number } | undefined;
    const typedOtp = (body[PREFIX_NAME + "txtOTP"] ?? "").trim();
    if (!otp) errors.otp = "Please click Send OTP first";
    else if (otp.exp < Date.now()) errors.otp = "OTP expired. Click Send OTP again";
    else if (typedOtp !== otp.code) errors.otp = "Invalid OTP";
    const typedCaptcha = (body[PREFIX_NAME + "txtCaptcha"] ?? "").trim().toUpperCase();
    if (!typedCaptcha || typedCaptcha !== c.s.captcha) errors.captcha = "Characters do not match. Try again";
    if (Object.keys(errors).length) { res.send(renderPage3(c, errors)); return; }

    const applicationId = `SSP-2026-${String(nextId++).padStart(6, "0")}`;
    applications.push({
      applicationId, submittedAt: new Date().toISOString(),
      personal: c.s.personalLabels as Record<string, string>,
      academic: c.s.academicLabels as Record<string, string>,
      certificate: { name: file!.originalname, size: file!.size },
      status: "Under verification",
    });
    c.s.lastApplicationId = applicationId;
    c.s.dob = (c.s.personal as Record<string, string>).date_of_birth;
    for (const k of ["personal", "personalLabels", "academic", "academicLabels", "otp", "captcha"]) delete c.s[k];
    res.redirect(303, "/apply/done");
  });

  app.get("/apply/done", (req, res) => {
    const c = ctx(req, res);
    const a = applications.find((x) => x.applicationId === c.s.lastApplicationId);
    if (!a) { res.redirect(303, "/"); return; }
    const summary = Object.entries({ ...a.personal, ...a.academic })
      .map(([k, v]) => `<tr><td class="${cls(c, "lbl")}">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("");
    res.send(render(c, "Application Submitted", `
<div class="${cls(c, "sec")}">Application Submitted Successfully</div>
<p>Your application has been received. Please note your Application ID for future reference.</p>
<p style="font-size:16px">Application ID: <b><span id="${PREFIX_ID}lblApplicationId">${a.applicationId}</span></b></p>
<table class="${cls(c, "frm")}">${summary}<tr><td class="${cls(c, "lbl")}">Status</td><td>${a.status}</td></tr></table>`));
  });

  // ── status lookup (read-only) ──────────────────────────────────────────────
  const statusForm = (c: Ctx, result = "") => render(c, "Application Status", `
<form method="post" action="/status" id="aspnetForm">
<div class="${cls(c, "sec")}">Check Application Status</div>
<table class="${cls(c, "frm")}">
<tr><td class="${cls(c, "lbl")}">Application ID</td><td><input ${attrs({ type: "text", id: PREFIX_ID + "txtAppId", name: PREFIX_NAME + "txtAppId", "data-mcpify": mc(c, "application_id") })}/></td></tr>
<tr><td class="${cls(c, "lbl")}">Date of Birth</td><td><input ${attrs({ type: "date", id: PREFIX_ID + "txtStatusDOB", name: PREFIX_NAME + "txtStatusDOB", "data-mcpify": mc(c, "date_of_birth") })}/></td></tr>
</table><p><input type="submit" class="${cls(c, "btn")}" ${attrs({ id: PREFIX_ID + "btnCheck", name: PREFIX_NAME + "btnCheck", value: "Check Status", "data-mcpify": mc(c, "check") })}/></p></form>${result}`);

  app.get("/status", (req, res) => { res.send(statusForm(ctx(req, res))); });
  app.post("/status", (req, res) => {
    const c = ctx(req, res);
    const id = String(req.body[PREFIX_NAME + "txtAppId"] ?? "").trim().toUpperCase();
    const dob = String(req.body[PREFIX_NAME + "txtStatusDOB"] ?? "").trim();
    const a = applications.find((x) => x.applicationId === id && x.personal["Date of Birth"] === dob);
    const result = a
      ? `<p>Status of <b>${esc(a.applicationId)}</b>: <span id="${PREFIX_ID}lblStatus" class="${cls(c, "info")}">${esc(a.status)}</span></p>`
      : `<p><span id="${PREFIX_ID}lblStatus" class="${cls(c, "error")}">No application found for these details.</span></p>`;
    res.send(statusForm(c, result));
  });

  // ── simulated phone ────────────────────────────────────────────────────────
  app.get("/phone", (_req, res) => {
    const items = sms.slice(0, 10).map((m) => `<div style="background:#fff;border-radius:12px;padding:10px 12px;margin:8px 0;box-shadow:0 1px 2px #0002">
<div style="font-size:11px;color:#777">To ******${esc(m.to.slice(-4))} · ${esc(new Date(m.at).toLocaleTimeString())}</div><div style="font-size:15px">${esc(m.text)}</div></div>`).join("");
    res.send(`<!doctype html><meta http-equiv="refresh" content="3"><title>Phone (simulated SMS)</title>
<body style="font-family:system-ui;background:#ddd;margin:0"><div style="max-width:360px;margin:20px auto;background:#eef;border:10px solid #222;border-radius:28px;min-height:560px;padding:14px">
<div style="text-align:center;font-weight:bold">Messages (simulated phone for the DEMO portal)</div>${items || '<p style="color:#666;text-align:center">No messages yet.</p>'}</div></body>`);
  });

  return app;
}
