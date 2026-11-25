import express, { type Request, type Response } from "express";
import multer from "multer";
import { attrs, esc, page } from "../shared/html.js";
import { labRouter } from "../shared/lab.js";
import { OTP_TTL_MS, newOtp, phoneHtml, type Sms } from "../shared/phone.js";
import { apiUrlOf, formRow, input, mc, ownerScript, portalCtx, submit, type PortalCtx } from "../shared/portal.js";
import { SessionStore } from "../shared/session.js";
import { EXISTING_PASSES, ROUTES, checkDateRange, checkPhoto, routeLabel, type ExistingPass } from "./data.js";

const PORTAL = "Student Bus Pass Portal (DEMO)";
const TAGLINE = "Demo City Transport Corporation (fictional) · Student Pass Renewal";
const NAV: [string, string][] = [["/", "Home"], ["/renew/1", "Renew Pass"], ["/status", "Pass Status"], ["/phone", "Phone (SMS)"]];
const HEAD_STYLE = "<style>.hdr{background:linear-gradient(#1f6b3a,#0f4224)}.sec{background:#1f6b3a}</style>";

export interface Renewal {
  passNumber: string; previousPass: string; name: string; route: string;
  validFrom: string; validTo: string; photo: { name: string; size: number }; issuedAt: string; status: string;
}
interface Draft { passNo?: string; confirmed?: boolean; route?: string; from?: string; to?: string; photo?: { name: string; size: number } }
type Errors = Record<string, string>;

export function createBusPassPortal(opts: { apiUrl?: string } = {}) {
  const app = express();
  const sessions = new SessionStore();
  const apiUrl = apiUrlOf(opts.apiUrl);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
  let renewals: Renewal[] = [];
  let sms: Sms[] = [];
  let nextPass = 501;
  let lastOtpSid = "";

  app.disable("x-powered-by");
  app.use(labRouter({
    mutations: new Set<string>(),
    knownMutations: {},
    state: () => ({ mutations: [], applications: renewals, renewals }),
    reset: () => { renewals = []; sms = []; nextPass = 501; sessions.clear(); },
    otpFor: (sid) => (sessions.get(sid === "latest" ? lastOtpSid : sid)?.otp as { code: string } | undefined)?.code,
    captchaFor: () => undefined,
  }));
  app.use(sessions.middleware());
  app.use(express.urlencoded({ extended: false }));

  const render = (c: PortalCtx, title: string, body: string) =>
    page({ portalName: PORTAL, tagline: TAGLINE, title, body, nav: NAV, footer: "Demo City Transport Corporation (fictional)", extraHead: HEAD_STYLE + ownerScript(c, apiUrl, "buspass") });
  const draftOf = (c: PortalCtx): Draft => (c.s.draft ??= {}) as Draft;
  const passOf = (d: Draft): ExistingPass | undefined => (d.passNo ? EXISTING_PASSES[d.passNo] : undefined);
  const err = (id: string, e?: string) => (e ? `<span class="error" id="${id}_err">${esc(e)}</span>` : "");
  /** Guards a renewal step: `ready` says whether the earlier steps are done. */
  const step = (ready: (d: Draft) => boolean, fn: (c: PortalCtx, d: Draft, req: Request, res: Response) => void) => (req: Request, res: Response) => {
    const c = portalCtx(req, res);
    const d = draftOf(c);
    if (!ready(d)) { res.redirect(303, "/renew/1"); return; }
    fn(c, d, req, res);
  };

  app.get("/", (req, res) => {
    const c = portalCtx(req, res);
    res.send(render(c, "Home", `<div class="sec">Welcome</div>
<p>Renew your student bus pass online. Keep your current pass number, a recent photo (JPG/PNG, max 500 KB) and your mobile phone ready.</p>
<ul><li><a id="lnkRenew" href="/renew/1">Renew Student Bus Pass</a></li><li><a id="lnkStatus" href="/status">Check Pass Status</a></li></ul>`));
  });

  // ── step 1: existing pass ──────────────────────────────────────────────────
  const page1 = (c: PortalCtx, v: { passNo?: string; dob?: string }, e = "") => render(c, "Renew - Step 1", `
<form method="post" action="/renew/1" id="frmRenew1"><div class="sec">Step 1 of 4 : Existing Pass</div>
<table class="frm">
${formRow("Existing Pass Number", "txtPassNo", input(c, { id: "txtPassNo", name: "passNumber", key: "pass_number", value: v.passNo, extra: { maxlength: 15, placeholder: "BPS-2025-000000" } }))}
${formRow("Date of Birth", "txtDob", input(c, { id: "txtDob", name: "dateOfBirth", key: "date_of_birth", type: "date", value: v.dob }))}
</table>${err("lblFind", e)}<p>${submit(c, "btnNext1", "next_1", "Next")}</p></form>`);

  app.get("/renew/1", (req, res) => { res.send(page1(portalCtx(req, res), {})); });
  app.post("/renew/1", (req, res) => {
    const c = portalCtx(req, res);
    const passNo = String(req.body.passNumber ?? "").trim().toUpperCase();
    const dob = String(req.body.dateOfBirth ?? "").trim();
    if (EXISTING_PASSES[passNo]?.dob !== dob) { res.send(page1(c, { passNo, dob }, "No pass found for this pass number and date of birth")); return; }
    c.s.draft = { passNo } satisfies Draft;
    res.redirect(303, "/renew/2");
  });

  // ── step 2: personal confirmation ──────────────────────────────────────────
  const page2 = (c: PortalCtx, p: ExistingPass, e = "") => render(c, "Renew - Step 2", `
<form method="post" action="/renew/2" id="frmRenew2"><div class="sec">Step 2 of 4 : Confirm Personal Details</div>
<table class="frm"><tr><td class="lbl">Name</td><td id="lblName">${esc(p.name)}</td></tr>
<tr><td class="lbl">Institution</td><td>${esc(p.college)}</td></tr>
<tr><td class="lbl">Mobile</td><td>******${esc(p.mobile.slice(-4))}</td></tr>
<tr><td class="lbl">Current route</td><td>${esc(routeLabel(p.route))}</td></tr>
<tr><td class="lbl">Valid till</td><td>${esc(p.validTill)}</td></tr>
<tr><td colspan="2"><input ${attrs({ type: "checkbox", id: "chkConfirm", name: "confirmDetails", value: "on", "data-mcpify": mc(c, "confirm_details") })}/>
<label for="chkConfirm">I confirm these details are correct</label>${err("chkConfirm", e)}</td></tr></table>
<p>${submit(c, "btnNext2", "next_2", "Next")}</p></form>`);

  app.get("/renew/2", step((d) => !!passOf(d), (c, d, _req, res) => { res.send(page2(c, passOf(d)!)); }));
  app.post("/renew/2", step((d) => !!passOf(d), (c, d, req, res) => {
    if (req.body.confirmDetails !== "on") { res.send(page2(c, passOf(d)!, "Please confirm your details")); return; }
    d.confirmed = true;
    res.redirect(303, "/renew/3");
  }));

  // ── step 3: photo, route, dates ────────────────────────────────────────────
  const page3 = (c: PortalCtx, v: Draft, e: Errors = {}) => {
    const opts = [`<option value="">--Select Route--</option>`, ...ROUTES.map((r) => `<option ${attrs({ value: r.value, selected: r.value === v.route })}>${esc(r.label)}</option>`)].join("");
    return render(c, "Renew - Step 3", `
<form method="post" action="/renew/3" enctype="multipart/form-data" id="frmRenew3"><div class="sec">Step 3 of 4 : Photo, Route and Validity</div>
<table class="frm">
${formRow("Photo (JPG/PNG, max 500 KB)", "fuPhoto", input(c, { id: "fuPhoto", name: "photo", key: "photo", type: "file", extra: { accept: ".jpg,.jpeg,.png" } }), e.photo)}
${formRow("Route", "ddlRoute", `<select ${attrs({ id: "ddlRoute", name: "route", "data-mcpify": mc(c, "route") })}>${opts}</select>`, e.route)}
${formRow("Valid From", "txtFromDate", input(c, { id: "txtFromDate", name: "fromDate", key: "from_date", type: "date", value: v.from }), e.from)}
${formRow("Valid To", "txtToDate", input(c, { id: "txtToDate", name: "toDate", key: "to_date", type: "date", value: v.to }), e.to)}
</table><p style="color:#555">The pass can be renewed for at most 6 months.</p><p>${submit(c, "btnNext3", "next_3", "Next")}</p></form>`);
  };

  const readyFor3 = (d: Draft) => !!passOf(d) && d.confirmed === true;
  app.get("/renew/3", step(readyFor3, (c, d, _req, res) => { res.send(page3(c, d)); }));
  app.post("/renew/3", upload.single("photo"), step(readyFor3, (c, d, req, res) => {
    const v: Draft = { ...d, route: String(req.body.route ?? ""), from: String(req.body.fromDate ?? "").trim(), to: String(req.body.toDate ?? "").trim() };
    const e: Errors = { ...checkDateRange(v.from!, v.to!) };
    const photoErr = checkPhoto(req.file);
    if (photoErr) e.photo = photoErr;
    if (!ROUTES.some((r) => r.value === v.route)) e.route = "Please select a route";
    if (Object.keys(e).length) { res.send(page3(c, v, e)); return; }
    c.s.draft = { ...v, photo: { name: req.file!.originalname, size: req.file!.size } } satisfies Draft;
    res.redirect(303, "/renew/4");
  }));

  // ── step 4: OTP and submit ─────────────────────────────────────────────────
  const readyFor4 = (d: Draft) => readyFor3(d) && !!d.photo && !!d.route;
  const page4 = (c: PortalCtx, d: Draft, e: Errors = {}) => {
    const otp = c.s.otp as { exp: number } | undefined;
    const sent = otp && otp.exp > Date.now() ? `<br/><span class="info" id="lblOtpMsg">OTP has been sent to your registered mobile number. It is valid for 5 minutes.</span>` : "";
    return render(c, "Renew - Step 4", `<div class="sec">Step 4 of 4 : Verify and Submit</div>
<table class="frm"><tr><td class="lbl">Route</td><td>${esc(routeLabel(d.route!))}</td></tr><tr><td class="lbl">Validity</td><td>${esc(d.from)} to ${esc(d.to)}</td></tr>
<tr><td class="lbl">Photo</td><td>${esc(d.photo!.name)}</td></tr></table>
<form method="post" action="/renew/4/send-otp" id="frmOtp"><table class="frm"><tr><td class="lbl">Mobile verification</td>
<td>An OTP will be sent to your registered mobile number ending <b>${esc(passOf(d)!.mobile.slice(-4))}</b>.<br/><br/>${submit(c, "btnSendOtp", "send_otp", "Send OTP")}${sent}</td></tr></table></form>
<form method="post" action="/renew/4" id="frmRenew4"><table class="frm">
${formRow("Enter OTP", "txtOtp", input(c, { id: "txtOtp", name: "otp", key: "otp", extra: { maxlength: 6, autocomplete: "off" } }), e.otp)}
</table><p>${submit(c, "btnSubmit", "submit_renewal", "Submit Renewal")}</p></form>`);
  };

  app.get("/renew/4", step(readyFor4, (c, d, _req, res) => { res.send(page4(c, d)); }));
  app.post("/renew/4/send-otp", step(readyFor4, (c, d, _req, res) => {
    const code = newOtp();
    c.s.otp = { code, exp: Date.now() + OTP_TTL_MS };
    lastOtpSid = c.sid;
    const to = passOf(d)!.mobile;
    sms.unshift({ to, text: `${code} is your OTP for ${PORTAL}. Valid for 5 minutes. Do not share it with anyone.`, at: new Date().toISOString() });
    console.log(`[portal:buspass] OTP for ******${to.slice(-4)}: ${code}`);
    res.redirect(303, "/renew/4");
  }));
  app.post("/renew/4", step(readyFor4, (c, d, req, res) => {
    const otp = c.s.otp as { code: string; exp: number } | undefined;
    const typed = String(req.body.otp ?? "").trim();
    const e = !otp ? "Please click Send OTP first" : otp.exp < Date.now() ? "OTP expired. Click Send OTP again" : typed !== otp.code ? "Invalid OTP" : "";
    if (e) { res.send(page4(c, d, { otp: e })); return; }
    const passNumber = `BPS-2026-${String(nextPass++).padStart(6, "0")}`;
    renewals.push({
      passNumber, previousPass: d.passNo!, name: passOf(d)!.name, route: routeLabel(d.route!),
      validFrom: d.from!, validTo: d.to!, photo: d.photo!, issuedAt: new Date().toISOString(), status: "Issued",
    });
    c.s.lastPass = passNumber;
    delete c.s.draft;
    delete c.s.otp;
    res.redirect(303, "/renew/done");
  }));

  app.get("/renew/done", (req, res) => {
    const c = portalCtx(req, res);
    const r = renewals.find((x) => x.passNumber === c.s.lastPass);
    if (!r) { res.redirect(303, "/"); return; }
    res.send(render(c, "Pass Renewed", `<div class="sec">Bus Pass Renewed Successfully</div>
<p style="font-size:16px">New Pass Number: <b><span id="lblPassNo">${esc(r.passNumber)}</span></b></p>
<table class="frm"><tr><td class="lbl">Name</td><td>${esc(r.name)}</td></tr><tr><td class="lbl">Route</td><td>${esc(r.route)}</td></tr>
<tr><td class="lbl">Valid</td><td>${esc(r.validFrom)} to ${esc(r.validTo)}</td></tr><tr><td class="lbl">Status</td><td>${esc(r.status)}</td></tr></table>`));
  });

  // ── status lookup (read-only) ──────────────────────────────────────────────
  const statusOf = (passNo: string): string | undefined => {
    const issued = renewals.find((r) => r.passNumber === passNo);
    if (issued) return `${issued.status}: valid ${issued.validFrom} to ${issued.validTo} (${issued.route})`;
    const renewedFrom = renewals.find((r) => r.previousPass === passNo);
    if (renewedFrom) return `Renewed as ${renewedFrom.passNumber}`;
    const old = EXISTING_PASSES[passNo];
    return old ? `Active: valid till ${old.validTill}` : undefined;
  };
  const statusForm = (c: PortalCtx, result = "") => render(c, "Pass Status", `
<form method="post" action="/status" id="frmStatus"><div class="sec">Check Pass Status</div>
<table class="frm">${formRow("Pass Number", "txtStatusPassNo", input(c, { id: "txtStatusPassNo", name: "passNumber", key: "pass_number", extra: { maxlength: 15 } }))}</table>
<p>${submit(c, "btnCheck", "check", "Check Status")}</p></form>${result}`);

  app.get("/status", (req, res) => { res.send(statusForm(portalCtx(req, res))); });
  app.post("/status", (req, res) => {
    const c = portalCtx(req, res);
    const passNo = String(req.body.passNumber ?? "").trim().toUpperCase();
    const s = statusOf(passNo);
    res.send(statusForm(c, s
      ? `<p>Status of <b>${esc(passNo)}</b>: <span id="lblPassStatus" class="info">${esc(s)}</span></p>`
      : `<p><span id="lblPassStatus" class="error">No pass found with this number.</span></p>`));
  });

  app.get("/phone", (_req, res) => { res.send(phoneHtml(sms)); });
  return app;
}
