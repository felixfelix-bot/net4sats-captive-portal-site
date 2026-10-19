import { describe, it, expect, vi, beforeEach } from 'vitest';

// BUG: fetchBalanceData() called fetch('/balance'), a RELATIVE path. On a captive
// portal served from :2051 that resolves to http://<router>:2051/balance, which is
// uhttpd serving the static docroot — there is no /balance there, so it 404s. The
// balance endpoint lives on the router API (:2121), the same origin the purchase
// flow already uses via getnet4satsBaseUrl().
//
// Consequence: the balance page showed "Balance unavailable" on every device, for
// every token, regardless of whether a session existed. It could never succeed.

vi.mock('../src/helpers/net4sats', async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    // the router API origin, exactly as the purchase path resolves it
    getnet4satsBaseUrl: () => 'http://192.168.1.1:2121',
  };
});

const i18n = (k) => k;

describe('fetchBalanceData hits the router API, not the portal docroot', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the absolute router API origin', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      calls.push(String(url));
      return { ok: true, json: async () => ({ status: 1, session_active: true }) };
    }));

    const { fetchBalanceData } = await import('../src/helpers/balance.js');
    await fetchBalanceData(i18n);

    expect(calls.length).toBe(1);
    // must be absolute and on the router API port, never a docroot-relative path
    expect(calls[0]).toBe('http://192.168.1.1:2121/balance');
    expect(calls[0]).not.toBe('/balance');
  });

  it('reports network failure when the fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { fetchBalanceData } = await import('../src/helpers/balance.js');
    const r = await fetchBalanceData(i18n);
    expect(r.status).toBe(0);
    expect(r.code).toBe('network');
  });

  it('reports network failure on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const { fetchBalanceData } = await import('../src/helpers/balance.js');
    const r = await fetchBalanceData(i18n);
    expect(r.status).toBe(0);
    expect(r.code).toBe('network');
  });
});
