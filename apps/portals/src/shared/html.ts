/** Tiny HTML helpers for server-rendered legacy-style pages. */
export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function attrs(a: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? k : `${k}="${esc(v)}"`))
    .join(" ");
}

export const LEGACY_CSS = `
body{margin:0;font-family:Verdana,Arial,sans-serif;font-size:12px;background:#e9e9e9;color:#222}
.demo-banner{background:#b00020;color:#fff;text-align:center;padding:6px;font-weight:bold;font-size:12px;letter-spacing:.3px}
.hdr{background:linear-gradient(#1d4f91,#123668);color:#fff;padding:10px 16px;border-bottom:4px solid #f0a500}
.hdr h1{margin:0;font-size:20px;font-family:Georgia,serif}.hdr small{color:#cfe0ff}
.nav{background:#d6dfec;padding:5px 16px;border-bottom:1px solid #9aa9c0}.nav a{color:#123668;margin-right:14px}
.wrap{width:880px;margin:14px auto;background:#fff;border:1px solid #9aa9c0;padding:12px 18px 22px}
.sec{background:#123668;color:#fff;padding:4px 8px;font-weight:bold;margin:12px 0 6px}
table.frm{border-collapse:collapse;width:100%}table.frm td{border:1px solid #c9d2df;padding:5px 7px;vertical-align:top}
td.lbl{background:#f2f5fa;width:38%;font-weight:bold}.req{color:#c00}
input[type=text],input[type=number],input[type=email],input[type=date],select{font-size:12px;padding:2px;width:240px;border:1px solid #7a8ba3}
.btn{background:#e8e8e8;border:1px solid #555;padding:3px 14px;font-size:12px;cursor:pointer}
.error{color:#d00000;font-size:11px;display:block}.info{color:#006400;font-weight:bold}
.captcha{display:inline-block;font:bold 22px "Courier New",monospace;letter-spacing:6px;padding:4px 10px;background:repeating-linear-gradient(45deg,#ddd,#ddd 4px,#f7f7f7 4px,#f7f7f7 8px);color:#333;transform:skewX(-12deg);text-decoration:line-through;user-select:none}
.foot{text-align:center;color:#666;font-size:10px;margin:10px}
`;

export function page(opts: { portalName: string; tagline: string; title: string; body: string; head?: string; extraHead?: string }): string {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN">
<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<title>${esc(opts.title)} :: ${esc(opts.portalName)}</title>
<style>${LEGACY_CSS}</style>${opts.extraHead ?? ""}</head>
<body>
<div class="demo-banner" id="demoBanner">DEMO PORTAL: not a real government website. Built for MCPify testing.</div>
<div class="hdr"><h1>${esc(opts.portalName)}</h1><small>${esc(opts.tagline)}</small></div>
<div class="nav"><a href="/">Home</a><a href="/apply/1">New Application</a><a href="/status">Check Status</a><a href="/phone" target="_blank">Phone (SMS)</a></div>
<div class="wrap">${opts.body}</div>
<div class="foot">Best viewed in Internet Explorer 8.0 at 1024 x 768 resolution. &copy; 2026 Demo Department (fictional).</div>
</body></html>`;
}
