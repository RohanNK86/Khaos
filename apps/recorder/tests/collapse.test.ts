import { expect, test } from 'vitest';
import type { ElementFingerprint, RecordedEvent } from '@mcpify/contracts';
import { collapseEvents } from '../src/collapse.js';

const fp = (tag: string, id: string, type?: string): ElementFingerprint => ({ tag, id, type, classes: [], cssPath: `#${id}`, xpath: `//*[@id="${id}"]` });
let seq = 0;
const ev = (type: RecordedEvent['type'], target?: ElementFingerprint, value?: string, url = 'http://x/a'): RecordedEvent =>
  ({ seq: seq++, t: seq, type, url, target, value });

test('merges repeated inputs, drops field/label clicks and duplicate submits, keeps redirect target only', () => {
  const name = fp('input', 'name', 'text');
  const out = collapseEvents([
    ev('navigate', undefined, undefined, 'about:blank'),
    ev('navigate'),
    ev('click', name),
    ev('input', name, 'A'),
    ev('click', fp('label', 'lbl')),
    ev('click', fp('select', 'sel')),
    ev('change', fp('select', 'sel'), 'Two'),
    ev('input', name, 'Asha'),
    ev('change', name, 'Asha'),
    ev('click', fp('td', 'cell')),
    ev('keydown_enter', name),
    ev('click', fp('input', 'go', 'submit')),
    ev('submit', fp('form', 'f')),
    ev('navigate', undefined, undefined, 'http://x/redirect'),
    ev('navigate', undefined, undefined, 'http://x/b'),
  ]);
  expect(out.map(e => `${e.type}:${e.target?.id ?? e.url}:${e.value ?? ''}`)).toEqual([
    'navigate:http://x/a:', 'change:name:Asha', 'change:sel:Two', 'click:go:', 'navigate:http://x/b:',
  ]);
  expect(out.map(e => e.seq)).toEqual([0, 1, 2, 3, 4]);
});
