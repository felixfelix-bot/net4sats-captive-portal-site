import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The balance page rendered raw i18n keys and "undefined undefined" on hardware even
// after the fetch was fixed. Two independent causes, pinned separately here:
//
//  1. BalancePage.jsx calls t('balance_active_label'), t('balance_remaining'),
//     t('balance_used'), t('balance_total'), t('balance_metric') — none of which exist
//     in public/locales/en.json. i18next echoes an unknown key back, so the UI printed
//     the key itself.
//
//  2. The router's /balance returns { usage, allotment, remaining, metric } but the
//     page read different field names, so every value was undefined.

const root = resolve(__dirname, '..');
const en = JSON.parse(readFileSync(resolve(root, 'public/locales/en.json'), 'utf8'));
const page = readFileSync(resolve(root, 'src/BalancePage.jsx'), 'utf8');

// every t('...') key the balance page actually references
const keysUsed = [...page.matchAll(/\bt\('([a-z0-9_]+)'/g)].map((m) => m[1]);

describe('balance page translation keys exist', () => {
  it('finds keys to check (guards against a silent regex miss)', () => {
    expect(keysUsed.length).toBeGreaterThan(5);
  });

  it.each([...new Set(keysUsed)])('en.json defines %s', (key) => {
    expect(en).toHaveProperty(key);
  });
});

describe('router /balance payload maps onto the page', () => {
  // the live shape, captured from the bench router after a real purchase
  const live = {
    status: 1,
    session_active: true,
    metric: 'bytes',
    usage: 1455104,
    allotment: 154140672,
    remaining: 152685568,
    start_time: 1792415127,
    mac: '50:76:af:2f:33:ed',
  };

  it('the fields the page reads are present on the live payload', async () => {
    const { mapBalancePayload } = await import('../src/helpers/balance.js');
    const mapped = mapBalancePayload(live);
    expect(mapped.sessionActive).toBe(true);
    expect(mapped.metric).toBe('bytes');
    // all three values must be NUMBERS, not undefined
    expect(mapped.remaining).toBe(152685568);
    expect(mapped.usage).toBe(1455104);
    expect(mapped.allotment).toBe(154140672);
    expect(mapped.startedAt).toBeInstanceOf(Date);
  });

  it('treats a no-session payload as inactive with zeroed values', async () => {
    const { mapBalancePayload } = await import('../src/helpers/balance.js');
    const mapped = mapBalancePayload({ status: 1, session_active: false, mac: 'x' });
    expect(mapped.sessionActive).toBe(false);
    expect(mapped.remaining).toBe(0);
    expect(mapped.allotment).toBe(0);
  });

  it('survives a null/garbage payload without throwing', async () => {
    const { mapBalancePayload } = await import('../src/helpers/balance.js');
    expect(() => mapBalancePayload(null)).not.toThrow();
    expect(mapBalancePayload(null).sessionActive).toBe(false);
  });
describe('formatted values are rendered, not "undefined undefined"', () => {
  // formatMetricValue returns a STRING ("145.6 MB"). The page's formatDisplayValue
  // wrapped it as `${formatted.value} ${formatted.unit}`, which on a string is
  // undefined undefined -- so every stat card showed that instead of the amount.
  it('formatDisplayValue returns a readable string for bytes', async () => {
    const { formatDisplayValue } = await import('../src/helpers/balance.js');
    const out = formatDisplayValue(152685568, 'bytes');
    expect(out).not.toContain('undefined');
    expect(out).toBe('145.6 MB');
  });

  it('formatDisplayValue handles zero and small values', async () => {
    const { formatDisplayValue } = await import('../src/helpers/balance.js');
    expect(formatDisplayValue(0, 'bytes')).toBe('0 B');
    expect(formatDisplayValue(2048, 'bytes')).toBe('2 KB');
  });

  it('formatDisplayValue handles milliseconds', async () => {
    const { formatDisplayValue } = await import('../src/helpers/balance.js');
    const out = formatDisplayValue(3600000, 'milliseconds');
    expect(out).not.toContain('undefined');
    expect(out).toContain('1h');
  });

  it('formatDisplayValue survives a missing value', async () => {
    const { formatDisplayValue } = await import('../src/helpers/balance.js');
    expect(formatDisplayValue(undefined, 'bytes')).toBe('—');
  });
});
});
