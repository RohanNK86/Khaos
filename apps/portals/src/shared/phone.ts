import { esc } from "./html.js";

export interface Sms { to: string; text: string; at: string }

/** The simulated phone: shows the last SMS messages sent by a demo portal (auto-refreshes). */
export function phoneHtml(sms: Sms[]): string {
  const items = sms.slice(0, 10).map((m) => `<div style="background:#fff;border-radius:12px;padding:10px 12px;margin:8px 0;box-shadow:0 1px 2px #0002">
<div style="font-size:11px;color:#777">To ******${esc(m.to.slice(-4))} · ${esc(new Date(m.at).toLocaleTimeString())}</div><div style="font-size:15px">${esc(m.text)}</div></div>`).join("");
  return `<!doctype html><meta http-equiv="refresh" content="3"><title>Phone (simulated SMS)</title>
<body style="font-family:system-ui;background:#ddd;margin:0"><div style="max-width:360px;margin:20px auto;background:#eef;border:10px solid #222;border-radius:28px;min-height:560px;padding:14px">
<div style="text-align:center;font-weight:bold">Messages (simulated phone for the DEMO portal)</div>${items || '<p style="color:#666;text-align:center">No messages yet.</p>'}</div></body>`;
}

/** A fresh 6-digit OTP. */
export const newOtp = () => String(Math.floor(100000 + Math.random() * 900000));
export const OTP_TTL_MS = 5 * 60 * 1000;
