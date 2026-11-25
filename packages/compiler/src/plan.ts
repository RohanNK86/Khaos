import type { RecordedEvent } from '@mcpify/contracts';
import { collapseEvents } from '@mcpify/recorder';
import type { PlannedStep, StepKind } from './types.js';

const MASK = '•••';
const TRIGGERS = new Set(['click', 'submit', 'keydown_enter']);

/** Latest snapshot taken on the same URL before event i (the page as the user saw it before acting). */
export function snapshotBefore(events: RecordedEvent[], i: number): string | undefined {
  const url = events[i]!.url;
  for (let j = i - 1; j >= 0; j--) {
    const e = events[j]!;
    if (e.url === url && e.domSnapshotBlobId) return e.domSnapshotBlobId;
  }
  return undefined;
}

function valueKind(e: RecordedEvent): StepKind | null {
  const t = e.target!;
  if (e.value === undefined) return null;
  if (e.value === MASK) return 'userInput';
  if (t.tag === 'select') return 'select';
  if (t.tag === 'input' && t.type === 'checkbox') return 'check';
  if (t.tag === 'input' && t.type === 'radio') return e.value === 'true' ? 'radio' : null;
  if (t.tag === 'input' && t.type === 'file') return e.value ? 'upload' : null;
  return 'fill';
}

/** Where the page went after a click: the navigations that follow it (last one wins), else the click's own snapshot. */
function outcome(events: RecordedEvent[], i: number): PlannedStep['after'] {
  let last: RecordedEvent | undefined;
  for (let j = i + 1; j < events.length && events[j]!.type === 'navigate'; j++) last = events[j];
  if (last) return { url: last.url, navigated: true, snapshotId: last.domSnapshotBlobId };
  const e = events[i]!;
  return { url: e.url, navigated: false, snapshotId: e.domSnapshotBlobId };
}

/**
 * Recording events → planned steps. A navigation becomes a step only when no click/submit caused it
 * (the first page load, or the user typing a URL); otherwise it describes the outcome of that click.
 */
export function planSteps(raw: RecordedEvent[], warnings: string[]): PlannedStep[] {
  const events = collapseEvents(raw);
  const steps: PlannedStep[] = [];
  events.forEach((e, i) => {
    const beforeId = snapshotBefore(events, i);
    if (e.type === 'navigate') {
      const cause = events[i - 1];
      if (!cause || !TRIGGERS.has(cause.type)) {
        steps.push({ kind: 'navigate', event: e, snapshotId: e.domSnapshotBlobId, beforeId });
      }
      return;
    }
    if (!e.target) return;
    if (e.type === 'input' || e.type === 'change') {
      const kind = valueKind(e);
      if (kind) steps.push({ kind, event: e, target: e.target, value: e.value, snapshotId: e.domSnapshotBlobId ?? beforeId, beforeId });
      return;
    }
    if (e.type === 'click' || e.type === 'submit') {
      steps.push({ kind: 'click', event: e, target: e.target, snapshotId: beforeId ?? e.domSnapshotBlobId, beforeId, after: outcome(events, i) });
      return;
    }
    warnings.push(`event #${e.seq} (${e.type}) has no step equivalent and was skipped`);
  });
  return steps;
}
