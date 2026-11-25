/** Tiny DOM helper: h(tag, props, children). Props starting with "on" are listeners; booleans toggle attributes. */
type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown>;

export function h(tag: string, props: Props = {}, children: Child | Child[] = []): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "value" || k === "checked" || k === "selected") (el as unknown as Record<string, unknown>)[k] = v;
    else if (typeof v === "boolean") el.toggleAttribute(k, v);
    else if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  }
  for (const c of Array.isArray(children) ? children : [children]) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

/** Replace the container's content; keeps the focused field's caret when it re-renders. */
export function mount(root: HTMLElement, nodes: (Node | null)[]) {
  const active = document.activeElement as HTMLElement | null;
  const key = active?.getAttribute("data-field") ?? active?.getAttribute("data-testid");
  root.replaceChildren(...nodes.filter((n): n is Node => n !== null));
  if (key) root.querySelector<HTMLElement>(`[data-field="${key}"],[data-testid="${key}"]`)?.focus();
}
