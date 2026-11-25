import { chromium } from 'playwright';
import { expect, test } from 'vitest';
import { installCapture } from './capture.js';

test('captures labels and masks sensitive fields before they leave the page', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const events: { type: string; target: { label?: string }; value?: string }[] = [];
    await context.exposeBinding('__mcpifyRecord', (_source, event) => events.push(event));
    await context.addInitScript(installCapture);
    const page = await context.newPage();
    await page.goto('data:text/html,<table><tr><td>Full Name:</td><td><input id="name"></td></tr><tr><td>OTP:</td><td><input id="otp"></td></tr></table>');
    await page.locator('#name').fill('Asha');
    await page.locator('#otp').fill('123456');
    await page.waitForTimeout(500);
    expect(events.some(e => e.target.label === 'Full Name' && e.value === 'Asha')).toBe(true);
    expect(events.some(e => e.target.label === 'OTP' && e.value === '•••')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('123456');
  } finally { await browser.close(); }
});
