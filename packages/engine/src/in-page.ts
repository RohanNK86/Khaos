/**
 * Plain-JS helpers that run INSIDE the web page (Playwright evaluate or a content script).
 * Kept as a string so bundlers cannot inject helpers into it. Installs window.__mcpify once.
 */
export const IN_PAGE_JS = String.raw`(() => {
if (window.__mcpify) return window.__mcpify;
const norm = (s) => String(s || "").replace(/[*:]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
const CONTROLS = "input:not([type=hidden]),select,textarea,button";
const visible = (el) => {
  if (!el || !el.isConnected) return false;
  if (el.type === "file") return true;
  const st = getComputedStyle(el);
  if (st.visibility === "hidden" || st.display === "none") return false;
  return el.getClientRects().length > 0;
};
const ownText = (el) => (el.innerText || el.textContent || "");
function labelsOf(el) {
  const out = [];
  if (el.getAttribute("aria-label")) out.push(el.getAttribute("aria-label"));
  const lb = el.getAttribute("aria-labelledby");
  if (lb) out.push(lb.split(/\s+/).map((id) => ownText(document.getElementById(id) || document.createElement("x"))).join(" "));
  if (el.id) for (const l of document.querySelectorAll('label[for="' + CSS.escape(el.id) + '"]')) out.push(ownText(l));
  const wrap = el.closest("label");
  if (wrap) out.push(ownText(wrap));
  const td = el.closest("td,th");
  if (td && td.previousElementSibling) out.push(ownText(td.previousElementSibling));
  if (el.placeholder) out.push(el.placeholder);
  return out.map(norm).filter(Boolean);
}
function accName(el) {
  return norm(el.getAttribute("aria-label") || (labelsOf(el)[0]) || (el.tagName === "INPUT" ? el.value : ownText(el)));
}
const ROLE_SEL = {
  button: "button,input[type=submit],input[type=button],input[type=reset],[role=button]",
  link: "a[href],[role=link]",
  textbox: "input:not([type]),input[type=text],input[type=email],input[type=number],input[type=tel],input[type=date],textarea,[role=textbox]",
  combobox: "select,[role=combobox]",
  checkbox: "input[type=checkbox],[role=checkbox]",
  radio: "input[type=radio],[role=radio]",
};
const CLICKABLE = "button,input[type=submit],input[type=button],a,[role=button],[role=link],label";
function candidates(loc) {
  const all = (sel) => Array.from(document.querySelectorAll(sel));
  switch (loc.kind) {
    case "testid": return all('[data-testid="' + CSS.escape(loc.value) + '"],[data-mcpify="' + CSS.escape(loc.value) + '"]');
    case "id": { const e = document.getElementById(loc.value); return e ? [e] : []; }
    case "name": return all('[name="' + CSS.escape(loc.value) + '"]');
    case "label": { const v = norm(loc.value); return all(CONTROLS).filter((e) => labelsOf(e).some((l) => l === v)); }
    case "role": { const sel = ROLE_SEL[loc.role] || '[role="' + loc.role + '"]'; const n = norm(loc.name); return all(sel).filter((e) => !n || accName(e) === n); }
    case "text": {
      const v = norm(loc.value);
      const c = all(CLICKABLE).filter((e) => norm(e.tagName === "INPUT" ? e.value : ownText(e)) === v);
      if (c.length) return c;
      return all("body *").filter((e) => norm(ownText(e)) === v && !Array.from(e.children).some((k) => norm(ownText(k)) === v));
    }
    case "css": return all(loc.value);
    case "near": {
      const a = norm(loc.anchorText);
      const anchors = all("body *").filter((e) => visible(e) && norm(ownText(e)).includes(a) && !Array.from(e.children).some((k) => norm(ownText(k)).includes(a)));
      for (const an of anchors) {
        const next = all(loc.tag).find((e) => an.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING && !an.contains(e));
        if (next) return [next];
      }
      return [];
    }
    case "xpath": {
      const r = document.evaluate(loc.value, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const out = []; for (let i = 0; i < r.snapshotLength; i++) out.push(r.snapshotItem(i)); return out;
    }
  }
  return [];
}
let refSeq = 0;
const api = {
  norm, labelsOf,
  /** Returns { index, ref } of the first locator that matches exactly one visible element. */
  resolve(locators) {
    for (let i = 0; i < locators.length; i++) {
      let els = [];
      try { els = candidates(locators[i]).filter(visible); } catch (e) { els = []; }
      if (els.length === 1) {
        const ref = "r" + (++refSeq);
        els[0].setAttribute("data-mcpify-ref", ref);
        return { index: i, ref };
      }
    }
    return null;
  },
  el(ref) { return document.querySelector('[data-mcpify-ref="' + ref + '"]'); },
  value(ref) {
    const e = api.el(ref); if (!e) return "";
    if (e.tagName === "SELECT") return e.selectedIndex >= 0 ? e.options[e.selectedIndex].text : "";
    if (e.type === "checkbox" || e.type === "radio") return String(e.checked);
    return e.value ?? "";
  },
  text(ref) { const e = api.el(ref); return e ? (e.tagName === "INPUT" ? e.value : ownText(e)) : ""; },
  optionIndex(ref, want) {
    const e = api.el(ref); if (!e) return -1; const w = norm(want);
    const opts = Array.from(e.options);
    let i = opts.findIndex((o) => norm(o.text) === w);
    if (i < 0) i = opts.findIndex((o) => o.value === want);
    return i;
  },
  hasErrorNear(ref) {
    const e = api.el(ref); if (!e) return false;
    const box = e.closest("td,li,p,.form-group,.field,div") || e.parentElement;
    return Array.from((box || document).querySelectorAll(".error,[role=alert],.field-validation-error,.text-danger")).some((x) => visible(x) && norm(ownText(x)));
  },
  errors() {
    return Array.from(document.querySelectorAll(".error,[role=alert],.field-validation-error,.text-danger"))
      .filter((x) => visible(x)).map((x) => ownText(x).trim()).filter(Boolean).slice(0, 5);
  },
  highlight(ref) {
    const e = api.el(ref); if (!e) return;
    e.scrollIntoView({ block: "center" });
    e.style.outline = "3px solid #FD9B36"; e.style.outlineOffset = "2px";
    setTimeout(() => { e.style.outline = ""; e.style.outlineOffset = ""; }, 900);
  },
};
window.__mcpify = api;
return api;
})()`;
