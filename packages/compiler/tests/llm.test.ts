import { afterEach, expect, test } from 'vitest';
import { setClaudeForTests, type ClaudeLike } from '@mcpify/llm';
import { compile, type LlmTool } from '../src/index.js';
import { portal1Fixture } from './fixture.js';

afterEach(() => { setClaudeForTests(null); delete process.env.LLM_DISABLED; });

const fake = (reply: (user: string) => LlmTool): ClaudeLike & { users: string[] } => {
  const users: string[] = [];
  return {
    users,
    messages: {
      parse: (async (p: { messages: { content: string }[] }) => {
        users.push(p.messages[0]!.content);
        return { stop_reason: 'end_turn', parsed_output: reply(users.at(-1)!), usage: { input_tokens: 1, output_tokens: 1 } };
      }) as never,
      create: (async () => { throw new Error('not used'); }) as never,
    },
  };
};

test('LLM pass: one call, sensitive values redacted, names/intents merged, risk can only go up', async () => {
  const { recording, loadSnapshot } = await portal1Fixture();
  const claude = fake(() => ({
    toolName: 'apply_state_scholarship',
    title: 'Apply for State Scholarship',
    description: 'Applies for the scholarship. Pauses for confirmation before sending the OTP and before submitting; asks for the OTP and CAPTCHA.',
    params: [
      { stepId: 'enter_annual_family_income', paramName: 'annual_income', label: 'Annual family income (Rs)', type: 'number', required: true, sensitive: false },
      { stepId: 'enter_mobile', paramName: 'mobile_number', label: 'Mobile number', type: 'string', required: true, sensitive: true },
    ],
    steps: [
      { stepId: 'send_otp', intent: 'Send an OTP to the applicant\'s mobile', riskOverride: 'fill' },
      { stepId: 'select_category', intent: 'Select the applicant\'s category', riskOverride: 'commit' },
    ],
    outputs: [{ name: 'application_id', description: 'The Application ID' }],
  }));
  setClaudeForTests(claude);
  const draft = await compile(recording, { loadSnapshot });
  expect(claude.users).toHaveLength(1);
  const prompt = claude.users[0]!;
  for (const secret of ['9876543210', 'asha.demo@example.com', '180000']) expect(prompt).not.toContain(secret);
  expect(prompt).toContain('enter_otp');

  expect(draft.name).toBe('apply_state_scholarship');
  expect(draft.title).toBe('Apply for State Scholarship');
  const props = draft.inputSchema.properties as Record<string, Record<string, unknown>>;
  expect(props.annual_income).toMatchObject({ type: 'integer', title: 'Annual family income (Rs)' });
  expect(props.annual_family_income).toBeUndefined();
  expect(props.mobile_number).toMatchObject({ sensitive: true });
  expect(draft.inputSchema.required).toContain('annual_income');
  expect(draft.examples).not.toHaveProperty('mobile_number');
  const income = draft.steps.find(s => s.id === 'enter_annual_income')!;
  expect(income.action).toEqual({ type: 'fill', param: 'annual_income' });
  expect(income.post[0]).toMatchObject({ kind: 'valueEquals', param: 'annual_income' });
  expect(draft.steps.find(s => s.id === 'send_otp')).toMatchObject({ risk: 'commit', repair: 'human', intent: 'Send an OTP to the applicant\'s mobile' });
  expect(draft.steps.find(s => s.id === 'select_category')).toMatchObject({ risk: 'commit', repair: 'human' });
}, 60_000);

test('LLM failure keeps the rules-only draft', async () => {
  const { recording, loadSnapshot } = await portal1Fixture();
  setClaudeForTests({ messages: { parse: (async () => { throw new Error('boom'); }) as never, create: (async () => undefined) as never } });
  const draft = await compile(recording, { loadSnapshot });
  expect(draft.name).toBe('apply_scholarship');
  expect(draft.warnings.some(w => w.startsWith('LLM pass skipped'))).toBe(true);
}, 60_000);
