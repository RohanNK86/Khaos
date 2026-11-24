/** Field model for Portal 1. `key` doubles as the owner-mode data-mcpify name and the tool param. */
export interface Field {
  key: string;
  ctl: string; // ASP.NET-style control id suffix, e.g. txtApplicantName
  label: string;
  kind: "text" | "date" | "email" | "number" | "select" | "checkbox";
  options?: { value: string; label: string }[];
  required: boolean;
  validate?: (v: string) => string | undefined; // returns error text
}

export const PREFIX_ID = "ctl00_ContentPlaceHolder1_";
export const PREFIX_NAME = "ctl00$ContentPlaceHolder1$";

const opt = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));

export function page1Fields(m: Set<string>): Field[] {
  const f: Field[] = [
    { key: "applicant_name", ctl: "txtApplicantName", label: "Applicant Name", kind: "text", required: true,
      validate: (v) => (/^[A-Za-z .]{3,60}$/.test(v) ? undefined : "Enter a valid name (letters only)") },
    { key: "date_of_birth", ctl: "txtDOB", label: "Date of Birth", kind: "date", required: true,
      validate: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? undefined : "Enter date as YYYY-MM-DD") },
    { key: "gender", ctl: "ddlGender", label: "Gender", kind: "select", required: true,
      options: opt([["M", "Male"], ["F", "Female"], ["O", "Other"]]) },
    { key: "mobile", ctl: "txtMobile", label: "Mobile Number", kind: "text", required: true,
      validate: (v) => (/^[6-9]\d{9}$/.test(v) ? undefined : "Mobile number must be 10 digits") },
    { key: "email", ctl: "txtEmail", label: "Email ID", kind: "email", required: true,
      validate: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? undefined : "Invalid email address") },
  ];
  if (m.has("M8")) {
    f.splice(2, 0, { key: "aadhaar_last4", ctl: "txtAadhaarLast4", label: "Aadhaar (last 4 digits)", kind: "text", required: true,
      validate: (v) => (/^\d{4}$/.test(v) ? undefined : "Enter last 4 digits") });
  }
  return f;
}

export function page2Fields(m: Set<string>): Field[] {
  const courses: [string, string][] = m.has("M9")
    ? [["01", "Bachelor of Science"], ["02", "Bachelor of Commerce"], ["03", "Bachelor of Arts"], ["04", "Bachelor of Engineering"], ["05", "Diploma"]]
    : [["01", "B.Sc"], ["02", "B.Com"], ["03", "B.A"], ["04", "B.E"], ["05", "Diploma"]];
  const f: Field[] = [
    { key: "course", ctl: "ddlCourse", label: "Course", kind: "select", required: true, options: opt(courses) },
    { key: "year_of_study", ctl: "ddlYear", label: "Year of Study", kind: "select", required: true,
      options: opt([["1", "1st Year"], ["2", "2nd Year"], ["3", "3rd Year"], ["4", "4th Year"]]) },
    { key: "institution_name", ctl: "txtInstitution", label: "Institution Name", kind: "text", required: true },
    { key: "annual_income", ctl: m.has("M2") ? "txtFamIncome" : "txtIncome",
      label: m.has("M1") ? "Family Income (per annum)" : "Annual family income", kind: "number", required: true,
      validate: (v) => (/^\d{1,9}$/.test(v) ? undefined : "Income must be a number") },
    { key: "category", ctl: "ddlCategory", label: "Category", kind: "select", required: true,
      options: opt([["GEN", "General"], ["OBC", "OBC"], ["SC", "SC"], ["ST", "ST"]]) },
  ];
  return m.has("M4") ? [f[3]!, f[4]!, f[0]!, f[2]!, f[1]!] : f;
}

export const DECLARATION = { key: "declaration", ctl: "chkDeclare", label: "I declare the above information is true" };

export const MUTATIONS: Record<string, string> = {
  M1: 'Label "Annual family income" becomes "Family Income (per annum)"',
  M2: "Income input id/name renamed (txtIncome to txtFamIncome)",
  M3: "Submit button moved above the OTP section",
  M4: "Fields on page 2 reordered",
  M5: "Page 2 wrapped in an extra div/table (CSS paths change)",
  M7: 'Next button text becomes "Continue"',
  M8: 'New required field "Aadhaar (last 4 digits)" on page 1',
  M9: 'Course options relabelled ("B.Sc" becomes "Bachelor of Science")',
  M10: "All CSS classes renamed with random suffixes",
};

/** Validate submitted values; returns errors keyed by field key. */
export function validate(fields: Field[], body: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = (body[PREFIX_NAME + f.ctl] ?? "").trim();
    if (f.required && (!v || (f.kind === "select" && v === "0"))) {
      errors[f.key] = f.kind === "select" ? "Please select a value" : "This field is required";
      continue;
    }
    if (f.kind === "select" && !f.options?.some((o) => o.value === v)) errors[f.key] = "Please select a value";
    else if (f.validate) {
      const e = f.validate(v);
      if (e) errors[f.key] = e;
    }
  }
  return errors;
}
