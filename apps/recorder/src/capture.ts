/** Inject into every document before page scripts run. */
export function installCapture(): void {
  const send = (window as unknown as { __mcpifyRecord: (event: unknown) => void }).__mcpifyRecord;
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
  const fingerprint = (el: Element) => {
    const field = el as HTMLInputElement;
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
    const form = el.closest('form');
    return { tag: el.tagName.toLowerCase(), type: field.type || undefined, id: el.id || undefined,
      name: el.getAttribute('name') || undefined, testid: el.getAttribute('data-testid') || el.getAttribute('data-mcpify') || undefined,
      classes: Array.from(el.classList), label: labelFor(el) || undefined, ariaLabel: el.getAttribute('aria-label') || undefined,
      role: el.getAttribute('role') || undefined, text: clean(el.textContent).slice(0, 200) || undefined,
      placeholder: el.getAttribute('placeholder') || undefined, nearText: nearText || undefined,
      cssPath: cssPath(el), xpath: xpath(el),
      options: el instanceof HTMLSelectElement ? Array.from(el.options).map(o => ({ value: o.value, label: clean(o.textContent) })) : undefined,
      inForm: form?.id || form?.getAttribute('name') || form?.getAttribute('action') || undefined };
  };
  const emit = (type: string, el: Element) => {
    const target = fingerprint(el);
    const field = el as HTMLInputElement;
    const sensitive = field.type === 'password' || /otp|captcha|password|pin|aadhaar/i.test([target.label, target.name, target.id, target.ariaLabel, target.placeholder].join(' '));
    const value = 'value' in field ? (sensitive ? '•••' : field.type === 'file' ? '' : field.type === 'checkbox' ? String(field.checked) : field.value) : undefined;
    send({ type, url: location.href, target, value });
  };
  const pending = new WeakMap<Element, ReturnType<typeof setTimeout>>();
  document.addEventListener('input', event => {
    if (!(event.target instanceof Element)) return;
    const el = event.target;
    clearTimeout(pending.get(el));
    pending.set(el, setTimeout(() => emit('input', el), 400));
  }, true);
  for (const type of ['click', 'change', 'submit'] as const) document.addEventListener(type, event => {
    if (event.target instanceof Element) emit(type, event.target);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target instanceof Element) emit('keydown_enter', event.target);
  }, true);
}
