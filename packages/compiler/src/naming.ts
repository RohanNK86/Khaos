/** Rules-only naming: snake_case params and step ids, intents, prompts. */

const STOP_PREFIX = /^(please\s+)?(enter|type|select|choose|pick|provide|upload|attach|your|the)\s+/i;
const CONTACT_SUFFIX = /\b(mobile|phone|email|e-mail|contact)\s+(number|no|id|address)\b/i;

export function snake(text: string, maxWords = 6): string {
  const words = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/['’]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, maxWords);
  const s = words.join('_');
  return /^[a-z]/.test(s) ? s : s ? `f_${s}` : '';
}

/** "ctl00$ContentPlaceHolder1$txtApplicantName" → "applicant_name" */
export function nameFromControlId(raw: string): string {
  const last = raw.split(/[$:.]/).pop() ?? raw;
  const tail = last.split('_').pop() ?? last;
  const stripped = tail.replace(/^(txt|ddl|chk|cb|rb|rdo|fu|btn|lbl|sel|inp|cmb|lst|hf|dt)(?=[A-Z])/, '');
  return snake(stripped.replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
}

const SENSITIVE_NAMES: [RegExp, string][] = [
  [/captcha/i, 'captcha'], [/\botp\b|one.?time/i, 'otp'], [/password|passwd/i, 'password'],
  [/\bpin\b/i, 'pin'], [/aadhaar/i, 'aadhaar'], [/cvv/i, 'cvv'],
];

/** Param name for a masked (OTP/CAPTCHA/password) field. */
export function sensitiveParamName(hints: (string | undefined)[]): string | undefined {
  const text = hints.filter(Boolean).join(' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return SENSITIVE_NAMES.find(([re]) => re.test(text))?.[1];
}

/** Param name from a field label (falls back to placeholder, aria-label, name, id). */
export function paramNameFromLabel(label: string | undefined, fallbacks: (string | undefined)[] = []): string {
  if (label) {
    if (/\bdeclar/i.test(label)) return 'declaration';
    if (/terms|conditions/i.test(label)) return 'accept_terms';
    if (/^i\s+(agree|consent|accept)/i.test(label)) return 'consent';
    const cleaned = label.replace(STOP_PREFIX, '').replace(CONTACT_SUFFIX, '$1');
    const name = snake(cleaned, 4);
    if (name) return name;
  }
  for (const f of fallbacks) {
    const name = f ? (/[$_]|[a-z][A-Z]/.test(f) ? nameFromControlId(f) : snake(f, 4)) : '';
    if (name) return name;
  }
  return 'value';
}

/** Make a name unique within `used` (adds _2, _3, ...). */
export function unique(name: string, used: Set<string>): string {
  let out = name;
  for (let i = 2; used.has(out); i++) out = `${name}_${i}`;
  used.add(out);
  return out;
}

/** "Step 2 of 3 : Academic and Income Details" → "Academic and Income Details" */
export const stripStepPrefix = (s: string) => s.replace(/^\s*step\s*\d+\s*(of\s*\d+)?\s*[:\-–.]\s*/i, '').trim();

export const humanize = (snakeName: string) => {
  const s = snakeName.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};


export function userInputPrompt(param: string, label: string | undefined): string {
  if (param === 'otp') return 'Please tell me the OTP sent to your mobile number.';
  if (param === 'captcha') return 'Please read me the CAPTCHA characters shown on the portal page.';
  return `Please tell me the value for "${label ?? humanize(param)}".`;
}

/** JS RegExp source matching a literal. */
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** "SSP-2026-000123" → "SSP-\d{4}-\d{6}" */
export function patternFromValue(value: string): string {
  return value.split(/(\d+)/).map((part, i) => (i % 2 ? `\\d{${part.length}}` : escapeRegex(part))).join('');
}
