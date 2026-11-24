import { createScholarshipPortal } from "./scholarship/app.js";

export { createScholarshipPortal };

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.PORTAL_SCHOLARSHIP_PORT ?? 5101);
  createScholarshipPortal().listen(port, () => {
    console.log(`[portal:scholarship] State Scholarship Portal (DEMO) on http://localhost:${port}`);
  });
}
