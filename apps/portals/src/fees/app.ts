import express, { type Request, type Response } from "express";
import { esc, page } from "../shared/html.js";
import { labRouter } from "../shared/lab.js";
import { OTP_TTL_MS, newOtp, phoneHtml, type Sms } from "../shared/phone.js";
import { apiUrlOf, formRow, input, ownerScript, portalCtx, submit, type PortalCtx } from "../shared/portal.js";
import { SessionStore } from "../shared/session.js";
import { DEMO_STUDENTS, FEE_HEADS, FEE_DUE_DATE, SEMESTER, checkCard, rupees, semesterFee, type CardForm } from "./data.js";

const PORTAL = "University Fee Portal (DEMO)";
const TAGLINE = "Demo Technological University (fictional) · Online Fee Payment";
const NAV: [string, string][] = [["/", "Home"], ["/login", "Student Login"], ["/dues", "My Dues"], ["/phone", "Phone (SMS)"], ["/logout", "Logout"]];
const HEAD_STYLE = "<style>.hdr{background:linear-gradient(#6b2a12,#40170a)}.sec{background:#6b2a12}.gw{border:2px dashed #b00020;background:#fffbe6;padding:8px 12px;margin:10px 0}</style>";

export interface Payment { receiptNo: string; studentId: string; semester: string; amount: number; cardLast4: string; paidAt: string }
interface Pending { amount: number; cardLast4: string; cardName: string }

export function createFeesPortal(opts: { apiUrl?: string } = {}) {
  const app = express();
  const sessions = new SessionStore();
  const apiUrl = apiUrlOf(opts.apiUrl);
  let payments: Payment[] = [];
  let sms: Sms[] = [];
  let nextReceipt = 1;
  let lastOtpSid = "";

  app.disable("x-powered-by");
  app.use(labRouter({
    mutations: new Set<string>(),
    knownMutations: {},
    state: () => ({ mutations: [], applications: payments, payments }),
    reset: () => { payments = []; sms = []; nextReceipt = 1; sessions.clear(); },
    otpFor: (sid) => (sessions.get(sid === "latest" ? lastOtpSid : sid)?.otp as { code: string } | undefined)?.code,
    captchaFor: () => undefined,
  }));
  app.use(sessions.middleware());
  app.use(express.urlencoded({ extended: false }));

  const render = (c: PortalCtx, title: string, body: string) =>
    page({ portalName: PORTAL, tagline: TAGLINE, title, body, nav: NAV, footer: "Demo Technological University (fictional)", extraHead: HEAD_STYLE + ownerScript(c, apiUrl, "fees") });
  const studentOf = (c: PortalCtx) => (typeof c.s.studentId === "string" ? DEMO_STUDENTS[c.s.studentId] : undefined);
  const paidBy = (id: string) => payments.find((p) => p.studentId === id && p.semester === SEMESTER);
  /** Runs `fn` only for a logged-in student; otherwise redirects to the login page. */
  const loggedIn = (fn: (c: PortalCtx, req: Request, res: Response) => void) => (req: Request, res: Response) => {
    const c = portalCtx(req, res);
    if (!studentOf(c)) { res.redirect(303, "/login"); return; }
    fn(c, req, res);
  };

  app.get("/", (req, res) => {
    const c = portalCtx(req, res);
    res.send(render(c, "Home", `<div class="sec">Welcome</div>
<p>Pay your semester fee online. Log in with your Student ID and password.</p>
<ul><li><a id="lnkLogin" href="/login">Student Login</a></li><li><a id="lnkDues" href="/dues">View Dues</a></li></ul>
<p style="color:#555">Last date for ${esc(SEMESTER)} fee: ${esc(FEE_DUE_DATE)}. Fee helpdesk: 1800-000-0001 (fictional).</p>`));
  });

  // ── login (auth) ───────────────────────────────────────────────────────────
  const loginForm = (c: PortalCtx, studentId = "", error = "") => render(c, "Student Login", `
<form method="post" action="/login" id="frmLogin" name="frmLogin">
<div class="sec">Student Login</div>
<table class="frm">
${formRow("Student ID", "txtStudentId", input(c, { id: "txtStudentId", name: "student_id", key: "student_id", value: studentId, extra: { maxlength: 15 } }))}
${formRow("Password", "txtPassword", input(c, { id: "txtPassword", name: "password", key: "password", type: "password", extra: { autocomplete: "off" } }))}
</table>${error ? `<span class="error" id="lblLoginError">${esc(error)}</span>` : ""}
<p>${submit(c, "btnLogin", "login", "Login")}</p></form>`);

  app.get("/login", (req, res) => { res.send(loginForm(portalCtx(req, res))); });
  app.post("/login", (req, res) => {
    const c = portalCtx(req, res);
    const id = String(req.body.student_id ?? "").trim().toUpperCase();
    const student = DEMO_STUDENTS[id];
    if (!student || String(req.body.password ?? "") !== student.password) {
      res.send(loginForm(c, id, "Invalid Student ID or Password")); return;
    }
    c.s.studentId = id;
    res.redirect(303, "/dues");
  });
  app.get("/logout", (req, res) => {
    const c = portalCtx(req, res);
    for (const k of ["studentId", "pending", "otp", "lastReceipt"]) delete c.s[k];
    res.redirect(303, "/");
  });

  // ── dues (read-only) ───────────────────────────────────────────────────────
  app.get("/dues", loggedIn((c, _req, res) => {
    const st = studentOf(c)!;
    const paid = paidBy(c.s.studentId as string);
    const heads = FEE_HEADS.map((h) => `<tr><td>${esc(h.head)}</td><td style="text-align:right">${rupees(h.amount)}</td></tr>`).join("");
    const pay = paid ? `<p class="info">Fee paid. Receipt No. ${esc(paid.receiptNo)}</p>`
      : `<form method="post" action="/pay/start" id="frmPayFee"><p>${submit(c, "btnPayFee", "pay_semester_fee", "Pay Semester Fee")}</p></form>`;
    res.send(render(c, "My Dues", `<div class="sec">Student Details</div>
<table class="frm"><tr><td class="lbl">Student ID</td><td id="lblStudentId">${esc(c.s.studentId)}</td></tr>
<tr><td class="lbl">Name</td><td>${esc(st.name)}</td></tr><tr><td class="lbl">Programme</td><td>${esc(st.programme)}</td></tr></table>
<div class="sec">Fee Dues : ${esc(SEMESTER)}</div>
<table class="frm" id="tblDues"><tr><th>Fee head</th><th>Amount</th></tr>${heads}
<tr><td class="lbl">Total semester fee</td><td style="text-align:right"><b id="lblSemesterFee">${rupees(semesterFee())}</b></td></tr>
<tr><td class="lbl">Amount due</td><td style="text-align:right"><b><span id="lblAmountDue">${rupees(paid ? 0 : semesterFee())}</span></b></td></tr>
<tr><td class="lbl">Due date</td><td style="text-align:right"><span id="lblDueDate">${esc(FEE_DUE_DATE)}</span></td></tr>
<tr><td class="lbl">Status</td><td style="text-align:right"><span id="lblFeeStatus">${paid ? "Paid" : "Due"}</span></td></tr></table>${pay}`));
  }));

  // ── simulated payment (card → Pay → OTP → receipt) ─────────────────────────
  const payForm = (c: PortalCtx, form: Partial<CardForm>, errors: Partial<Record<keyof CardForm, string>>) => render(c, "Pay Semester Fee", `
<div class="sec">Simulated Payment Gateway (DEMO)</div>
<div class="gw" id="simNotice"><b>This is a simulation; no money moves.</b> Only the DEMO test card 4111 1111 1111 1111 is accepted. Never type a real card number here.</div>
<p>Paying <b id="lblPayAmount">${rupees(semesterFee())}</b> for ${esc(SEMESTER)} (Student ID ${esc(c.s.studentId)}).</p>
<form method="post" action="/pay" id="frmPay" name="frmPay">
<table class="frm">
${formRow("Card Number", "txtCardNumber", input(c, { id: "txtCardNumber", name: "card_number", key: "card_number", extra: { maxlength: 19, autocomplete: "off", placeholder: "4111 1111 1111 1111" } }), errors.cardNumber)}
${formRow("Expiry (MM/YY)", "txtExpiry", input(c, { id: "txtExpiry", name: "card_expiry", key: "card_expiry", extra: { maxlength: 5, autocomplete: "off", placeholder: "MM/YY" } }), errors.expiry)}
${formRow("CVV", "txtCvv", input(c, { id: "txtCvv", name: "card_cvv", key: "card_cvv", type: "password", extra: { maxlength: 3, autocomplete: "off" } }), errors.cvv)}
${formRow("Name on Card", "txtCardName", input(c, { id: "txtCardName", name: "card_name", key: "name_on_card", value: form.name, extra: { maxlength: 40 } }), errors.name)}
</table><p>${submit(c, "btnPay", "pay", "Pay")} &nbsp; <a href="/dues">Cancel</a></p></form>`);

  /** "Pay Semester Fee" only opens the payment page (nothing is charged). */
  app.post("/pay/start", loggedIn((_c, _req, res) => { res.redirect(303, "/pay"); }));
  app.get("/pay", loggedIn((c, _req, res) => {
    if (paidBy(c.s.studentId as string)) { res.redirect(303, "/dues"); return; }
    res.send(payForm(c, {}, {}));
  }));
  app.post("/pay", loggedIn((c, req, res) => {
    if (paidBy(c.s.studentId as string)) { res.redirect(303, "/dues"); return; }
    const form: CardForm = { cardNumber: String(req.body.card_number ?? ""), expiry: String(req.body.card_expiry ?? ""), cvv: String(req.body.card_cvv ?? ""), name: String(req.body.card_name ?? "").trim() };
    const errors = checkCard(form, new Date());
    if (Object.keys(errors).length) { res.send(payForm(c, form, errors)); return; }
    const pending: Pending = { amount: semesterFee(), cardLast4: form.cardNumber.replace(/\D/g, "").slice(-4), cardName: form.name };
    c.s.pending = pending;
    sendOtp(c, pending.amount);
    res.redirect(303, "/pay/verify");
  }));

  function sendOtp(c: PortalCtx, amount: number) {
    const code = newOtp();
    c.s.otp = { code, exp: Date.now() + OTP_TTL_MS };
    lastOtpSid = c.sid;
    const to = DEMO_STUDENTS[c.s.studentId as string]!.mobile;
    sms.unshift({ to, text: `${code} is the OTP for your simulated payment of ${rupees(amount)} on ${PORTAL}. No money moves. Do not share it.`, at: new Date().toISOString() });
    console.log(`[portal:fees] OTP for ******${to.slice(-4)}: ${code}`);
  }

  const otpForm = (c: PortalCtx, error = "") => {
    const p = c.s.pending as Pending;
    const mobile = DEMO_STUDENTS[c.s.studentId as string]!.mobile.slice(-4);
    return render(c, "Verify Payment", `<div class="sec">Simulated Bank Verification (DEMO)</div>
<div class="gw"><b>This is a simulation; no money moves.</b></div>
<p><span class="info" id="lblOtpMsg">OTP has been sent to your registered mobile number ending ${esc(mobile)}.</span> Amount ${rupees(p.amount)}, card ending ${esc(p.cardLast4)}.</p>
<form method="post" action="/pay/verify" id="frmVerify"><table class="frm">
${formRow("Enter OTP", "txtOtp", input(c, { id: "txtOtp", name: "otp", key: "otp", extra: { maxlength: 6, autocomplete: "off" } }), error)}
</table><p>${submit(c, "btnSubmitOtp", "submit_otp", "Submit OTP")}</p></form>`);
  };

  app.get("/pay/verify", loggedIn((c, _req, res) => {
    if (!c.s.pending) { res.redirect(303, "/dues"); return; }
    res.send(otpForm(c));
  }));
  app.post("/pay/verify", loggedIn((c, req, res) => {
    const pending = c.s.pending as Pending | undefined;
    if (!pending) { res.redirect(303, "/dues"); return; }
    const otp = c.s.otp as { code: string; exp: number } | undefined;
    const typed = String(req.body.otp ?? "").trim();
    if (!otp || otp.exp < Date.now()) { res.send(otpForm(c, "OTP expired. Go back to My Dues and pay again")); return; }
    if (typed !== otp.code) { res.send(otpForm(c, "Invalid OTP")); return; }
    const receiptNo = `UFP-RCPT-2026-${String(nextReceipt++).padStart(5, "0")}`;
    payments.push({ receiptNo, studentId: c.s.studentId as string, semester: SEMESTER, amount: pending.amount, cardLast4: pending.cardLast4, paidAt: new Date().toISOString() });
    c.s.lastReceipt = receiptNo;
    delete c.s.pending;
    delete c.s.otp;
    res.redirect(303, "/pay/receipt");
  }));

  app.get("/pay/receipt", loggedIn((c, _req, res) => {
    const p = payments.find((x) => x.receiptNo === c.s.lastReceipt);
    if (!p) { res.redirect(303, "/dues"); return; }
    res.send(render(c, "Payment Receipt", `<div class="sec">Payment Successful (simulated)</div>
<div class="gw">This is a simulation; no money moves. This receipt is for the DEMO portal only.</div>
<p style="font-size:16px">Receipt No.: <b><span id="lblReceiptNo">${esc(p.receiptNo)}</span></b></p>
<table class="frm"><tr><td class="lbl">Student ID</td><td>${esc(p.studentId)}</td></tr><tr><td class="lbl">Semester</td><td>${esc(p.semester)}</td></tr>
<tr><td class="lbl">Amount paid</td><td id="lblAmountPaid">${rupees(p.amount)}</td></tr><tr><td class="lbl">Card</td><td>XXXX XXXX XXXX ${esc(p.cardLast4)}</td></tr>
<tr><td class="lbl">Paid at</td><td>${esc(new Date(p.paidAt).toLocaleString("en-IN"))}</td></tr></table>`));
  }));

  app.get("/phone", (_req, res) => { res.send(phoneHtml(sms)); });
  return app;
}
