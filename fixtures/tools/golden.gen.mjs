// Generates the hand-written golden tools for Portal 1. Run: node fixtures/tools/golden.gen.mjs
import { writeFileSync } from "node:fs";

const ORIGIN = "http://localhost:5101";
const P = "ctl00_ContentPlaceHolder1_";
const N = "ctl00$ContentPlaceHolder1$";
const NOW = "2026-11-25T00:00:00.000Z";

const field = (ctl, testid, label) => [
  { kind: "testid", value: testid },
  { kind: "id", value: P + ctl },
  { kind: "name", value: N + ctl },
  ...(label ? [{ kind: "label", value: label }] : []),
];
const button = (ctl, testid, text) => [
  { kind: "testid", value: testid },
  { kind: "id", value: P + ctl },
  { kind: "role", role: "button", name: text },
  { kind: "text", value: text },
];
const vis = (locs) => [{ kind: "visible", locators: locs }];

function fillStep(id, intent, type, param, ctl, label) {
  const locators = field(ctl, param, label);
  return {
    id, intent, action: { type, param }, locators, pre: vis(locators),
    post: [{ kind: "valueEquals", locators, param }, { kind: "noErrorNear", locators }],
    risk: "fill", repair: "auto",
  };
}
function clickStep(id, intent, ctl, testid, text, risk, post) {
  const locators = button(ctl, testid, text);
  return { id, intent, action: { type: "click" }, locators, pre: vis(locators), post, risk, repair: risk === "commit" ? "human" : "auto", timeoutMs: 15000 };
}

const apply = {
  id: "5c1a0b6e-0000-4000-8000-000000000001",
  siteId: "site-scholarship",
  name: "apply_scholarship",
  title: "Apply for State Scholarship",
  description:
    "Apply for the Post-Matric Scholarship 2026-27 on the State Scholarship Portal (DEMO). Fills all three pages of the form. " +
    "It PAUSES for the user's confirmation before sending the OTP and again before the final submission, and asks the user for the OTP (sent to their mobile) and the CAPTCHA shown on the page. " +
    "Returns application_id.",
  version: 1,
  status: "approved",
  inputSchema: {
    type: "object",
    properties: {
      applicant_name: { type: "string", title: "Applicant name" },
      date_of_birth: { type: "string", format: "date", title: "Date of birth", description: "YYYY-MM-DD" },
      gender: { type: "string", enum: ["Male", "Female", "Other"], title: "Gender" },
      mobile: { type: "string", pattern: "^[6-9]\\d{9}$", title: "Mobile number", description: "10 digits; the OTP is sent here" },
      email: { type: "string", format: "email", title: "Email" },
      course: { type: "string", enum: ["B.Sc", "B.Com", "B.A", "B.E", "Diploma"], title: "Course" },
      year_of_study: { type: "string", enum: ["1st Year", "2nd Year", "3rd Year", "4th Year"], title: "Year of study" },
      institution_name: { type: "string", title: "Institution name" },
      annual_income: { type: "integer", minimum: 0, title: "Annual family income (Rs)" },
      category: { type: "string", enum: ["General", "OBC", "SC", "ST"], title: "Category" },
      declaration: { type: "boolean", const: true, title: "Declaration that the information is true" },
      income_certificate: { type: "string", default: "sample-income-certificate.pdf", title: "Income certificate file", description: "File name in the MCPify file store" },
    },
    required: ["applicant_name", "date_of_birth", "gender", "mobile", "email", "course", "year_of_study", "institution_name", "annual_income", "category", "declaration"],
    additionalProperties: false,
  },
  outputs: ["application_id"],
  startUrl: `${ORIGIN}/apply/1`,
  steps: [
    { id: "open_application_form", intent: "Open the new scholarship application form", action: { type: "navigate", url: `${ORIGIN}/apply/1` },
      locators: [], pre: [], post: [{ kind: "urlMatches", pattern: "/apply/1$" }, { kind: "textPresent", text: "Personal Details" }], risk: "read", repair: "auto" },
    fillStep("enter_applicant_name", "Fill the applicant's full name", "fill", "applicant_name", "txtApplicantName", "Applicant Name"),
    fillStep("enter_date_of_birth", "Fill the applicant's date of birth", "fill", "date_of_birth", "txtDOB", "Date of Birth"),
    fillStep("select_gender", "Select the applicant's gender", "select", "gender", "ddlGender", "Gender"),
    fillStep("enter_mobile", "Fill the applicant's mobile number", "fill", "mobile", "txtMobile", "Mobile Number"),
    fillStep("enter_email", "Fill the applicant's email address", "fill", "email", "txtEmail", "Email ID"),
    clickStep("continue_to_academic_details", "Save personal details and go to the academic details page", "btnNext1", "next_1", "Next", "fill",
      [{ kind: "urlMatches", pattern: "/apply/2$" }]),
    fillStep("select_course", "Select the course of study", "select", "course", "ddlCourse", "Course"),
    fillStep("select_year_of_study", "Select the year of study", "select", "year_of_study", "ddlYear", "Year of Study"),
    fillStep("enter_institution_name", "Fill the institution name", "fill", "institution_name", "txtInstitution", "Institution Name"),
    fillStep("enter_annual_income", "Fill the applicant's annual family income", "fill", "annual_income", "txtIncome", "Annual family income"),
    fillStep("select_category", "Select the applicant's category", "select", "category", "ddlCategory", "Category"),
    fillStep("accept_declaration", "Tick the declaration that the information is true", "check", "declaration", "chkDeclare", "I declare the above information is true"),
    clickStep("continue_to_documents", "Save academic details and go to the documents page", "btnNext2", "next_2", "Next", "fill",
      [{ kind: "urlMatches", pattern: "/apply/3$" }]),
    clickStep("send_otp", "Send an OTP to the applicant's registered mobile number", "btnSendOtp", "send_otp", "Send OTP", "commit",
      [{ kind: "textPresent", text: "OTP has been sent" }]),
    { id: "enter_otp", intent: "Enter the OTP the applicant received by SMS", action: { type: "userInput", param: "otp", prompt: "Please tell me the 6-digit OTP sent to your mobile number." },
      locators: field("txtOTP", "otp", "Enter OTP"), pre: vis(field("txtOTP", "otp", "Enter OTP")), post: [], risk: "auth", repair: "human", sensitive: true },
    { id: "upload_income_certificate", intent: "Upload the income certificate", action: { type: "upload", param: "income_certificate" },
      locators: field("fuIncomeCert", "income_certificate", "Income Certificate (PDF/JPG, max 1 MB)"), pre: vis(field("fuIncomeCert", "income_certificate")), post: [], risk: "fill", repair: "auto" },
    { id: "enter_captcha", intent: "Enter the CAPTCHA characters shown on the page", action: { type: "userInput", param: "captcha", prompt: "Please read me the 5 CAPTCHA characters shown on the portal page." },
      locators: field("txtCaptcha", "captcha", "Type the characters shown"), pre: vis(field("txtCaptcha", "captcha", "Type the characters shown")), post: [], risk: "auth", repair: "human", sensitive: true },
    clickStep("submit_application", "Submit the scholarship application", "btnSubmit", "submit_application", "Submit Application", "commit",
      [{ kind: "urlMatches", pattern: "/apply/done$" }]),
    { id: "read_application_id", intent: "Read the Application ID from the confirmation page", action: { type: "extract" },
      locators: [{ kind: "id", value: P + "lblApplicationId" }, { kind: "near", anchorText: "Application ID", tag: "b" }], pre: [],
      post: [{ kind: "extract", locators: [{ kind: "id", value: P + "lblApplicationId" }, { kind: "near", anchorText: "Application ID:", tag: "span" }], as: "application_id", pattern: "SSP-\\d{4}-\\d{6}" }],
      risk: "read", repair: "auto" },
  ],
  createdAt: NOW,
  updatedAt: NOW,
};

const status = {
  id: "5c1a0b6e-0000-4000-8000-000000000002",
  siteId: "site-scholarship",
  name: "check_application_status",
  title: "Check scholarship application status",
  description: "Look up the status of a scholarship application on the State Scholarship Portal (DEMO) with the Application ID and date of birth. Read-only: nothing is submitted, no pauses. Returns application_status.",
  version: 1,
  status: "approved",
  inputSchema: {
    type: "object",
    properties: {
      application_id: { type: "string", pattern: "^SSP-\\d{4}-\\d{6}$", title: "Application ID" },
      date_of_birth: { type: "string", format: "date", title: "Date of birth", description: "YYYY-MM-DD" },
    },
    required: ["application_id", "date_of_birth"],
    additionalProperties: false,
  },
  outputs: ["application_status"],
  startUrl: `${ORIGIN}/status`,
  steps: [
    { id: "open_status_page", intent: "Open the application status page", action: { type: "navigate", url: `${ORIGIN}/status` }, locators: [], pre: [],
      post: [{ kind: "textPresent", text: "Check Application Status" }], risk: "read", repair: "auto" },
    fillStep("enter_application_id", "Fill the Application ID", "fill", "application_id", "txtAppId", "Application ID"),
    fillStep("enter_date_of_birth", "Fill the applicant's date of birth", "fill", "date_of_birth", "txtStatusDOB", "Date of Birth"),
    clickStep("check_status", "Look up the status", "btnCheck", "check", "Check Status", "read", [{ kind: "visible", locators: [{ kind: "id", value: P + "lblStatus" }] }]),
    { id: "read_status", intent: "Read the application status", action: { type: "extract" }, locators: [{ kind: "id", value: P + "lblStatus" }], pre: [],
      post: [{ kind: "extract", locators: [{ kind: "id", value: P + "lblStatus" }], as: "application_status" }], risk: "read", repair: "auto" },
  ],
  createdAt: NOW,
  updatedAt: NOW,
};

for (const t of [apply, status]) {
  writeFileSync(new URL(`./scholarship.${t.name}.v${t.version}.json`, import.meta.url), JSON.stringify(t, null, 2) + "\n");
}
console.log("wrote golden tools");
