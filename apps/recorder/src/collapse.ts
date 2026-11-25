import type { ElementFingerprint, RecordedEvent } from '@mcpify/contracts';

const BUTTON_INPUT = /^(submit|button|reset|image)$/;
const CLICK_ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'option', 'checkbox', 'radio', 'switch']);

/** True when the element is something a click is meaningful on (button, link, submit input, ARIA widget). */
export function isClickTarget(t: ElementFingerprint): boolean {
  if (t.tag === 'button' || t.tag === 'a') return true;
  if (t.tag === 'input') return BUTTON_INPUT.test(t.type ?? '');
  return Boolean(t.role && CLICK_ROLES.has(t.role));
}

/** Stable key for "the same field on the same page". */
export const fieldKey = (e: RecordedEvent) => `${e.url}|${e.target?.id ?? e.target?.name ?? e.target?.cssPath ?? ''}`;

const isValueEvent = (e: RecordedEvent) => e.type === 'input' || e.type === 'change';
const isBoundary = (e: RecordedEvent) => !isValueEvent(e);
const isHttp = (url: string) => /^https?:/i.test(url);

/** Merge a later input/change on the same field into the earlier one (keeps the first position, the last value). */
function mergeValue(out: RecordedEvent[], e: RecordedEvent): boolean {
  for (let i = out.length - 1; i >= 0; i--) {
    const prev = out[i]!;
    if (isBoundary(prev)) return false;
    if (fieldKey(prev) !== fieldKey(e)) continue;
    out[i] = {
      ...prev, t: e.t, value: e.value, target: e.target ?? prev.target,
      type: prev.type === 'change' || e.type === 'change' ? 'change' : 'input',
      domSnapshotBlobId: e.domSnapshotBlobId ?? prev.domSnapshotBlobId,
    };
    return true;
  }
  return false;
}

function keep(e: RecordedEvent, next: RecordedEvent | undefined, prev: RecordedEvent | undefined): boolean {
  if (!isHttp(e.url)) return false;
  if (e.type === 'click') return Boolean(e.target && isClickTarget(e.target));
  // a submit right after a click on a submit button is the same user action
  if (e.type === 'submit') return !(prev?.type === 'click');
  // Enter in a field: the following submit/click carries the meaning
  if (e.type === 'keydown_enter') return !(next && (next.type === 'submit' || next.type === 'click'));
  return true;
}

/**
 * Remove recording noise: label clicks, clicks on text fields/selects/checkboxes (their change event carries the value),
 * repeated inputs on one field, submit events duplicated by a button click, Enter presses that triggered a submit,
 * and redirect chains (consecutive navigations keep only the last). Renumbers `seq`.
 */
export function collapseEvents(events: RecordedEvent[]): RecordedEvent[] {
  const out: RecordedEvent[] = [];
  events.forEach((e, i) => {
    if (!keep(e, events[i + 1], out.at(-1))) return;
    if (isValueEvent(e) && mergeValue(out, e)) return;
    if (e.type === 'navigate' && out.at(-1)?.type === 'navigate') {
      out[out.length - 1] = e;
      return;
    }
    out.push(e);
  });
  return out.map((e, seq) => ({ ...e, seq }));
}
