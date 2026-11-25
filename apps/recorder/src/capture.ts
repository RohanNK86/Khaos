/**
 * Inject into every document before page scripts run (context.addInitScript).
 * Self-contained: it is serialised into the page, so it must not reference anything outside its body.
 * Also installs `window.__mcpifyFingerprint(el)` so the compiler can fingerprint elements in DOM snapshots.
 */
export function installCapture(): void {
  const w = window as unknown as {
    __mcpifyRecord?: (event: unknown) => void;
    __mcpifyStop?: () => void;
    __mcpifyFingerprint?: (el: Element) => unknown;
    __mcpifyCaptureInstalled?: boolean;
  };
  if (w.__mcpifyCaptureInstalled) return;
  w.__mcpifyCaptureInstalled = true;
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').replace(/[\s:*]+$/g, '').trim();
  const labelFor = (el: Element): string => {
    const input = el as HTMLInputElement;
    const labelled = el.getAttribute('aria-labelledby');
    return clean(input.labels?.[0]?.textContent || el.closest('label')?.textContent ||
      labelled?.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ') ||
      el.closest('td')?.previousElementSibling?.textContent || el.getAttribute('aria-label'));
  };
  const cssPath = (el: Element): string => {
    const parts: string[] = [];
    for (let current: Element | null = el; current; current = current.parentElement) {
      let part = current.tagName.toLowerCase();
      if (current.id) part += `#${CSS.escape(current.id)}`;
      else if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children).filter(e => e.tagName === current!.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      const path = parts.join(' > ');
      if (document.querySelectorAll(path).length === 1) return path;
    }
    return parts.join(' > ');
  };
  const xpath = (el: Element): string => {
    const parts: string[] = [];
    for (let current: Element | null = el; current; current = current.parentElement) {
      const siblings: Element[] = current.parentElement ? Array.from(current.parentElement.children).filter(e => e.tagName === current!.tagName) : [current];
      parts.unshift(`${current.tagName.toLowerCase()}[${siblings.indexOf(current) + 1}]`);
    }
    return '/' + parts.join('/');
  };
  const isButtonInput = (el: Element) => el.tagName === 'INPUT' && /^(submit|button|reset|image)$/i.test((el as HTMLInputElement).type);
  const nearTextOf = (el: Element): string => {
    let previous: Element | null = el;
    let nearText = '';
    while (previous && !nearText) {
      let sibling: Element | null = previous.previousElementSibling;
      while (sibling && !nearText) {
        const heading = sibling.matches('h1,h2,h3,h4,h5,h6,legend') ? sibling : sibling.querySelector('h1,h2,h3,h4,h5,h6,legend');
        nearText = clean(heading?.textContent);
        sibling = sibling.previousElementSibling;
      }
      previous = previous.parentElement;
    }
    return nearText;
  };
  const fingerprint = (el: Element) => {
    const field = el as HTMLInputElement;
    const form = el.closest('form');
    const text = isButtonInput(el) ? clean(field.value) : el.tagName === 'SELECT' ? '' : clean(el.textContent).slice(0, 200);
    return { tag: el.tagName.toLowerCase(), type: el.getAttribute('type')?.toLowerCase() || (el.tagName === 'INPUT' ? 'text' : undefined),
      id: el.id || undefined, name: el.getAttribute('name') || undefined,
      testid: el.getAttribute('data-testid') || el.getAttribute('data-mcpify') || undefined,
      classes: Array.from(el.classList), label: labelFor(el) || undefined, ariaLabel: el.getAttribute('aria-label') || undefined,
      role: el.getAttribute('role') || undefined, text: text || undefined,
      placeholder: el.getAttribute('placeholder') || undefined, nearText: nearTextOf(el) || undefined,
      cssPath: cssPath(el), xpath: xpath(el),
      options: el instanceof HTMLSelectElement ? Array.from(el.options).map(o => ({ value: o.value, label: clean(o.textContent) })) : undefined,
      inForm: form?.id || form?.getAttribute('name') || form?.getAttribute('action') || undefined };
  };
  w.__mcpifyFingerprint = fingerprint;
  const send = (event: unknown) => { try { w.__mcpifyRecord?.(event); } catch { /* recorder not attached */ } };
  const SENSITIVE = /otp|captcha|password|passwd|pin\b|aadhaar|cvv/i;
  const valueOf = (el: Element, sensitive: boolean): string | undefined => {
    const field = el as HTMLInputElement;
    if (!('value' in field) || isButtonInput(el) || el.tagName === 'BUTTON') return undefined;
    if (sensitive) return '•••';
    if (field.type === 'file') return field.files?.[0]?.name ?? '';
    if (field.type === 'checkbox' || field.type === 'radio') return String(field.checked);
    // <select>: record the visible option label (the engine selects by label first)
    if (el instanceof HTMLSelectElement) return el.selectedIndex >= 0 ? clean(el.options[el.selectedIndex]?.textContent) : '';
    return field.value;
  };
  const emit = (type: string, el: Element) => {
    const target = fingerprint(el);
    const sensitive = (el as HTMLInputElement).type === 'password' ||
      SENSITIVE.test([target.label, target.name, target.id, target.ariaLabel, target.placeholder].join(' '));
    send({ type, url: location.href, target, value: valueOf(el, sensitive) });
  };
  const pending = new Map<Element, ReturnType<typeof setTimeout>>();
  /** Emit debounced inputs now (keeps event order when the user moves to another field or clicks). */
  const flush = (except?: Element) => {
    for (const [el, timer] of pending) {
      if (el === except) continue;
      clearTimeout(timer);
      pending.delete(el);
      emit('input', el);
    }
  };
  document.addEventListener('input', event => {
    if (!(event.target instanceof Element)) return;
    const el = event.target;
    flush(el);
    clearTimeout(pending.get(el));
    pending.set(el, setTimeout(() => { pending.delete(el); emit('input', el); }, 400));
  }, true);
  const CLICKABLE = 'button,a[href],input,select,textarea,label,[role=button],[role=link],[role=tab],[role=menuitem],[onclick]';
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    flush();
    emit('click', event.target.closest(CLICKABLE) ?? event.target);
  }, true);
  for (const type of ['change', 'submit'] as const) document.addEventListener(type, event => {
    if (!(event.target instanceof Element)) return;
    if (type === 'change') { clearTimeout(pending.get(event.target)); pending.delete(event.target); }
    flush();
    emit(type, event.target);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      flush();
      try { w.__mcpifyStop?.(); } catch { /* recorder not attached */ }
      return;
    }
    if (event.key === 'Enter' && event.target instanceof Element) { flush(); emit('keydown_enter', event.target); }
  }, true);
  window.addEventListener('pagehide', () => flush(), true);
}

/** The capture script as a string (avoids esbuild `__name` helpers breaking serialisation under tsx/vitest). */
export const CAPTURE_JS = `(() => { window.__name = window.__name || ((f) => f); (${installCapture.toString()})(); })();`;
