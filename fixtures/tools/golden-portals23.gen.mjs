// Generates the hand-written golden tools for Portal 2 (fees) and Portal 3 (buspass).
// Run: node fixtures/tools/golden-portals23.gen.mjs   (same conventions as golden.gen.mjs)
import { writeFileSync } from "node:fs";

const FEES = "http://localhost:5102";
const BUS = "http://localhost:5103";
const NOW = "2026-11-26T00:00:00.000Z";

// Locator order: testid (owner-mode data-mcpify) → id → name → label | role → text.
const field = (id, name, testid, label) => [
  { kind: "testid", value: testid },
  { kind: "id", value: id },
  { kind: "name", value: name },
  ...(label ? [{ kind: "label", value: label }] : []),
];
const button = (id, testid, text) => [
  { kind: "testid", value: testid },
  { kind: "id", value: id },
  { kind: "role", role: "button", name: text },
  { kind: "text", value: text },
];
const vis = (locs) => [{ kind: "visible", locators: locs }];

function fillStep(id, intent, type, param, f) {
  const locators = field(f.id, f.name, param, f.label);
  return {
    id, intent, action: { type, param }, locators, pre: vis(locators),
    post: [{ kind: "valueEquals", locators, param }, { kind: "noErrorNear", locators }],
    risk: "fill", repair: "auto",
  };
}
function clickStep(id, intent, b, risk, post) {
  const locators = button(b.id, b.testid, b.text);
  return { id, intent, action: { type: "click" }, locators, pre: vis(locators), post, risk, repair: risk === "read" || risk === "fill" ? "auto" : "human", timeoutMs: 15000 };
}
/** A value only the human may give (password, card, OTP): risk auth, sensitive, never auto-repaired. */
function askStep(id, intent, param, prompt, f) {
  const locators = field(f.id, f.name, f.testid ?? param, f.label);
  return { id, intent, action: { type: "userInput", param, prompt }, locators, pre: vis(locators), post: [], risk: "auth", repair: "human", sensitive: true };
}
function extractStep(id, intent, elId, anchor, as, pattern) {
  const locators = [{ kind: "id", value: elId }, ...(anchor ? [{ kind: "near", anchorText: anchor, tag: "span" }] : [])];
  return { id, intent, action: { type: "extract" }, locators, pre: [], post: [{ kind: "extract", locators, as, ...(pattern ? { pattern } : {}) }], risk: "read", repair: "auto" };
}

// ── Portal 2: University Fee Portal (DEMO) ──────────────────────────────────
const F = {
  studentId: { id: "txtStudentId", name: "student_id", label: "Student ID" },
  password: { id: "txtPassword", name: "password", label: "Password" },
  cardNumber: { id: "txtCardNumber", name: "card_number", label: "Card Number" },
  expiry: { id: "txtExpiry", name: "card_expiry", label: "Expiry (MM/YY)" },
  cvv: { id: "txtCvv", name: "card_cvv", label: "CVV" },
  cardName: { id: "txtCardName", name: "card_name", label: "Name on Card" },
  otp: { id: "txtOtp", name: "otp", label: "Enter OTP" },
};
const loginSteps = (dest) => [
  { id: "open_login_page", intent: "Open the student login page", action: { type: "navigate", url: `${FEES}/login` },
    locators: [], pre: [], post: [{ kind: "urlMatches", pattern: "/login$" }, { kind: "textPresent", text: "Student Login" }], risk: "read", repair: "auto" },
  fillStep("enter_student_id", "Fill the student ID", "fill", "student_id", F.studentId),
  askStep("enter_password", "Enter the student's portal password", "password", "Please type your fee portal password. I will not store it.", F.password),
  clickStep("log_in", "Log in to the fee portal", { id: "btnLogin", testid: "login", text: "Login" }, "auth",
    [{ kind: "urlMatches", pattern: dest }]),
];
const studentIdProp = { type: "string", pattern: "^[A-Z]{4}\\d{7}$", title: "Student ID", description: "As printed on the student ID card, e.g. DEMO2026001" };

const checkDues = {
  id: "5c1a0b6e-0000-4000-8000-000000000003",
  siteId: "site-fees",
  name: "check_dues",
  title: "Check semester fee dues",
  description:
    "Look up the semester fee dues on the University Fee Portal (DEMO). Read-only: nothing is paid or submitted. " +
    "It PAUSES once to ask the user for their portal password (used to log in, never stored). Returns amount_due, due_date and fee_status.",
  version: 1,
  status: "approved",
  inputSchema: {
    type: "object",
    properties: { student_id: studentIdProp },
    required: ["student_id"],
    additionalProperties: false,
  },
  outputs: ["amount_due", "due_date", "fee_status"],
  startUrl: `${FEES}/login`,
  steps: [
    ...loginSteps("/dues$"),
    extractStep("read_amount_due", "Read the amount due for this semester", "lblAmountDue", "Amount due", "amount_due", "Rs\\. [\\d,]+\\.\\d{2}"),
    extractStep("read_due_date", "Read the fee due date", "lblDueDate", "Due date", "due_date", "\\d{2}-\\d{2}-\\d{4}"),
    extractStep("read_fee_status", "Read whether the fee is paid or due", "lblFeeStatus", "Status", "fee_status"),
  ],
  createdAt: NOW,
  updatedAt: NOW,
};

const payFee = {
  id: "5c1a0b6e-0000-4000-8000-000000000004",
  siteId: "site-fees",
  name: "pay_semester_fee",
  title: "Pay semester fee",
  description:
    "Pay the semester fee on the University Fee Portal (DEMO) through its simulated payment gateway (no money moves). " +
    "Payment is never automated without the human: it PAUSES to ask the user for their portal password and for the card number, expiry and CVV (never stored), " +
    "PAUSES for the user's confirmation before pressing Pay (irreversible), and then asks for the OTP sent to their registered mobile. Returns receipt_number and amount_paid.",
  version: 1,
  status: "approved",
  inputSchema: {
    type: "object",
    properties: {
      student_id: studentIdProp,
      name_on_card: { type: "string", title: "Name on card", description: "As printed on the card" },
    },
    required: ["student_id", "name_on_card"],
    additionalProperties: false,
  },
  outputs: ["receipt_number", "amount_paid"],
  startUrl: `${FEES}/login`,
  steps: [
    ...loginSteps("/dues$"),
    clickStep("open_payment_page", "Open the payment page for the semester fee", { id: "btnPayFee", testid: "pay_semester_fee", text: "Pay Semester Fee" }, "fill",
      [{ kind: "urlMatches", pattern: "/pay$" }, { kind: "textPresent", text: "This is a simulation; no money moves" }]),
    askStep("enter_card_number", "Enter the card number", "card_number", "Please type the card number (DEMO test card only). I will not store it.", F.cardNumber),
    askStep("enter_card_expiry", "Enter the card expiry date", "card_expiry", "Please type the card expiry as MM/YY.", F.expiry),
    askStep("enter_card_cvv", "Enter the card CVV", "card_cvv", "Please type the 3-digit CVV on the back of the card. I will not store it.", F.cvv),
    fillStep("enter_name_on_card", "Fill the name as printed on the card", "fill", "name_on_card", F.cardName),
    clickStep("pay", "Pay the semester fee with the card", { id: "btnPay", testid: "pay", text: "Pay" }, "commit",
      [{ kind: "urlMatches", pattern: "/pay/verify$" }, { kind: "textPresent", text: "OTP has been sent" }]),
    askStep("enter_payment_otp", "Enter the payment OTP the student received by SMS", "otp", "Please tell me the 6-digit OTP sent to your mobile number to approve the payment.", F.otp),
    clickStep("submit_payment_otp", "Submit the OTP to approve the payment", { id: "btnSubmitOtp", testid: "submit_otp", text: "Submit OTP" }, "auth",
      [{ kind: "urlMatches", pattern: "/pay/receipt$" }]),
    extractStep("read_receipt_number", "Read the receipt number from the receipt page", "lblReceiptNo", undefined, "receipt_number", "UFP-RCPT-\\d{4}-\\d{5}"),
    extractStep("read_amount_paid", "Read the amount paid", "lblAmountPaid", undefined, "amount_paid", "Rs\\. [\\d,]+\\.\\d{2}"),
  ],
  createdAt: NOW,
  updatedAt: NOW,
};

// ── Portal 3: Student Bus Pass Portal (DEMO) ────────────────────────────────
const B = {
  passNo: { id: "txtPassNo", name: "passNumber", label: "Existing Pass Number" },
  dob: { id: "txtDob", name: "dateOfBirth", label: "Date of Birth" },
  confirm: { id: "chkConfirm", name: "confirmDetails", label: "I confirm these details are correct" },
  photo: { id: "fuPhoto", name: "photo", label: "Photo (JPG/PNG, max 500 KB)" },
  route: { id: "ddlRoute", name: "route", label: "Route" },
  from: { id: "txtFromDate", name: "fromDate", label: "Valid From" },
  to: { id: "txtToDate", name: "toDate", label: "Valid To" },
  otp: { id: "txtOtp", name: "otp", label: "Enter OTP" },
};
const ROUTES = ["Route 7: Old Bus Stand - Demo University", "Route 12: Railway Station - Demo Government College", "Route 21: Lake Circle - Demo Polytechnic"];

const renewPass = {
  id: "5c1a0b6e-0000-4000-8000-000000000005",
  siteId: "site-buspass",
  name: "renew_bus_pass",
  title: "Renew student bus pass",
  description:
    "Renew a student bus pass on the Student Bus Pass Portal (DEMO): finds the existing pass, confirms the personal details, uploads the photo, picks the route and validity dates (at most 6 months). " +
    "It PAUSES for the user's confirmation before sending the OTP and again before the final submission, and asks the user for the OTP sent to their registered mobile. Returns pass_number.",
  version: 1,
  status: "approved",
  inputSchema: {
    type: "object",
    properties: {
      pass_number: { type: "string", pattern: "^BPS-\\d{4}-\\d{6}$", title: "Existing pass number" },
      date_of_birth: { type: "string", format: "date", title: "Date of birth", description: "YYYY-MM-DD" },
      confirm_details: { type: "boolean", const: true, title: "Confirmation that the personal details shown are correct" },
      photo: { type: "string", default: "sample-student-photo.png", title: "Photo file", description: "JPG/PNG, max 500 KB; file name in the MCPify file store" },
      route: { type: "string", enum: ROUTES, title: "Route" },
      from_date: { type: "string", format: "date", title: "Valid from", description: "YYYY-MM-DD" },
      to_date: { type: "string", format: "date", title: "Valid to", description: "YYYY-MM-DD; after valid from, at most 6 months later" },
    },
    required: ["pass_number", "date_of_birth", "confirm_details", "route", "from_date", "to_date"],
    additionalProperties: false,
  },
  outputs: ["pass_number"],
  startUrl: `${BUS}/renew/1`,
  steps: [
    { id: "open_renewal_form", intent: "Open the bus pass renewal form", action: { type: "navigate", url: `${BUS}/renew/1` },
      locators: [], pre: [], post: [{ kind: "urlMatches", pattern: "/renew/1$" }, { kind: "textPresent", text: "Existing Pass" }], risk: "read", repair: "auto" },
    fillStep("enter_pass_number", "Fill the existing bus pass number", "fill", "pass_number", B.passNo),
    fillStep("enter_date_of_birth", "Fill the pass holder's date of birth", "fill", "date_of_birth", B.dob),
    clickStep("continue_to_confirmation", "Find the pass and go to the personal details page", { id: "btnNext1", testid: "next_1", text: "Next" }, "fill",
      [{ kind: "urlMatches", pattern: "/renew/2$" }]),
    fillStep("confirm_personal_details", "Tick the confirmation that the personal details are correct", "check", "confirm_details", B.confirm),
    clickStep("continue_to_route_and_dates", "Save the confirmation and go to the photo, route and dates page", { id: "btnNext2", testid: "next_2", text: "Next" }, "fill",
      [{ kind: "urlMatches", pattern: "/renew/3$" }]),
    { id: "upload_photo", intent: "Upload the pass holder's photo", action: { type: "upload", param: "photo" },
      locators: field(B.photo.id, B.photo.name, "photo", B.photo.label), pre: vis(field(B.photo.id, B.photo.name, "photo")), post: [], risk: "fill", repair: "auto" },
    fillStep("select_route", "Select the bus route", "select", "route", B.route),
    fillStep("enter_from_date", "Fill the date the renewed pass is valid from", "fill", "from_date", B.from),
    fillStep("enter_to_date", "Fill the date the renewed pass is valid to", "fill", "to_date", B.to),
    clickStep("continue_to_verification", "Save photo, route and dates and go to the verification page", { id: "btnNext3", testid: "next_3", text: "Next" }, "fill",
      [{ kind: "urlMatches", pattern: "/renew/4$" }]),
    clickStep("send_otp", "Send an OTP to the pass holder's registered mobile number", { id: "btnSendOtp", testid: "send_otp", text: "Send OTP" }, "commit",
      [{ kind: "textPresent", text: "OTP has been sent" }]),
    askStep("enter_otp", "Enter the OTP the pass holder received by SMS", "otp", "Please tell me the 6-digit OTP sent to your mobile number.", B.otp),
    clickStep("submit_renewal", "Submit the bus pass renewal", { id: "btnSubmit", testid: "submit_renewal", text: "Submit Renewal" }, "commit",
      [{ kind: "urlMatches", pattern: "/renew/done$" }]),
    extractStep("read_pass_number", "Read the new pass number from the confirmation page", "lblPassNo", undefined, "pass_number", "BPS-\\d{4}-\\d{6}"),
  ],
  createdAt: NOW,
  updatedAt: NOW,
};

const out = [["fees", checkDues], ["fees", payFee], ["buspass", renewPass]];
for (const [slug, t] of out) {
  writeFileSync(new URL(`./${slug}.${t.name}.v${t.version}.json`, import.meta.url), JSON.stringify(t, null, 2) + "\n");
}
console.log("wrote golden tools for portals 2 and 3");
