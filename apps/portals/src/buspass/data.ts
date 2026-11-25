/** Fictional data for Portal 3. */
export interface ExistingPass { name: string; dob: string; college: string; mobile: string; route: string; validTill: string }

export const EXISTING_PASSES: Record<string, ExistingPass> = {
  "BPS-2025-004217": { name: "Meera Demo", dob: "2004-08-19", college: "Demo Government College (fictional)", mobile: "9988776655", route: "R12", validTill: "2026-11-30" },
  "BPS-2025-003150": { name: "Arjun Sample", dob: "2003-01-05", college: "Demo Polytechnic (fictional)", mobile: "9876501234", route: "R21", validTill: "2026-12-31" },
};

export const ROUTES: { value: string; label: string }[] = [
  { value: "R07", label: "Route 7: Old Bus Stand - Demo University" },
  { value: "R12", label: "Route 12: Railway Station - Demo Government College" },
  { value: "R21", label: "Route 21: Lake Circle - Demo Polytechnic" },
];
export const routeLabel = (v: string) => ROUTES.find((r) => r.value === v)?.label ?? v;

export const MAX_PHOTO_BYTES = 500 * 1024;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** to must be after from and at most 6 months after it. Returns error text or undefined. */
export function checkDateRange(from: string, to: string): { from?: string; to?: string } {
  if (!DATE.test(from) || Number.isNaN(Date.parse(from))) return { from: "Enter the From date as YYYY-MM-DD" };
  if (!DATE.test(to) || Number.isNaN(Date.parse(to))) return { to: "Enter the To date as YYYY-MM-DD" };
  if (to <= from) return { to: "To date must be after From date" };
  const max = new Date(`${from}T00:00:00Z`);
  max.setUTCMonth(max.getUTCMonth() + 6);
  if (new Date(`${to}T00:00:00Z`) > max) return { to: "A pass can be renewed for at most 6 months" };
  return {};
}

/** Photo must be JPG or PNG and at most 500 KB. */
export function checkPhoto(file: { originalname: string; mimetype: string; size: number } | undefined): string | undefined {
  if (!file) return "Please upload your photo";
  if (!/\.(jpe?g|png)$/i.test(file.originalname) || !/^image\/(jpeg|png)$/.test(file.mimetype)) return "Only JPG or PNG photos are allowed";
  if (file.size > MAX_PHOTO_BYTES) return "Photo must be 500 KB or smaller";
  return undefined;
}
