/** Fictional data for Portal 2. Credentials are documented in the README; they protect nothing. */
export interface DemoStudent { password: string; name: string; programme: string; mobile: string }

export const DEMO_STUDENTS: Record<string, DemoStudent> = {
  DEMO2026001: { password: "demo@123", name: "Ravi Demo", programme: "B.E. Computer Science (fictional)", mobile: "9876543210" },
  DEMO2026002: { password: "demo@456", name: "Neha Sample", programme: "B.Com (fictional)", mobile: "9123456780" },
};

export const SEMESTER = "Semester 5 (Odd 2026-27)";
export const FEE_DUE_DATE = "15-12-2026";
export const FEE_HEADS = [
  { head: "Tuition Fee", amount: 38000 },
  { head: "Laboratory Fee", amount: 4000 },
  { head: "Library Fee", amount: 2500 },
  { head: "Examination Fee", amount: 1000 },
];
export const semesterFee = () => FEE_HEADS.reduce((a, h) => a + h.amount, 0);
export const rupees = (n: number) => `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The only card the simulated gateway accepts. */
export const TEST_CARD = "4111111111111111";

export interface CardForm { cardNumber: string; expiry: string; cvv: string; name: string }

/** Validate the fake card form; returns error text per field. */
export function checkCard(f: CardForm, now: Date): Partial<Record<keyof CardForm, string>> {
  const e: Partial<Record<keyof CardForm, string>> = {};
  if (f.cardNumber.replace(/[\s-]/g, "") !== TEST_CARD) e.cardNumber = "Card declined: only the DEMO test card 4111 1111 1111 1111 is accepted";
  const m = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(f.expiry.trim());
  if (!m) e.expiry = "Enter expiry as MM/YY";
  else if (new Date(2000 + Number(m[2]), Number(m[1]), 1) <= now) e.expiry = "Card has expired";
  if (!/^\d{3}$/.test(f.cvv.trim())) e.cvv = "CVV must be 3 digits";
  if (!/^[A-Za-z .]{2,40}$/.test(f.name)) e.name = "Enter the name as printed on the card";
  return e;
}
