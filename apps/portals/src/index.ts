import { createBusPassPortal } from "./buspass/app.js";
import { createFeesPortal } from "./fees/app.js";
import { createScholarshipPortal } from "./scholarship/app.js";

export { createScholarshipPortal, createFeesPortal, createBusPassPortal };

const PORTALS = [
  { slug: "scholarship", name: "State Scholarship Portal (DEMO)", env: "PORTAL_SCHOLARSHIP_PORT", port: 5101, create: createScholarshipPortal },
  { slug: "fees", name: "University Fee Portal (DEMO)", env: "PORTAL_FEES_PORT", port: 5102, create: createFeesPortal },
  { slug: "buspass", name: "Student Bus Pass Portal (DEMO)", env: "PORTAL_BUSPASS_PORT", port: 5103, create: createBusPassPortal },
] as const;

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  for (const p of PORTALS) {
    const port = Number(process.env[p.env] ?? p.port);
    p.create().listen(port, () => console.log(`[portal:${p.slug}] ${p.name} on http://localhost:${port}`));
  }
}
