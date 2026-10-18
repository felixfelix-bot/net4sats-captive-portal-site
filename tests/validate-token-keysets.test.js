import { describe, it, expect, vi } from 'vitest';

// #CU102 regression. Two distinct defects were behind it:
//   1. getDecodedToken(token) was called with NO keysets, so modern tokens (short
//      keyset ids) threw "A short keyset ID v2 was encountered, but got no keysets
//      to map it to." and validated as CU102 for every mint.
//   2. The `mint` argument is an access-option OBJECT ({url, metric, step_size}),
//      not a URL string, so even a lookup would have been given the wrong thing.
// It is also a chicken-and-egg: decoding needs the mint, but the mint can only be
// read from a decoded token. So the helper tries candidate mints until one decodes.

const KEYSETS = { keysets: [{ id: '009a1f293253e41e', unit: 'sat', active: true, input_fee_ppk: 10 }] };

vi.mock('@cashu/cashu-ts', async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    CashuMint: class {
      constructor(url) { this.url = url; }
      async getKeySets() {
        if (this.url === 'https://dead.mint') throw new Error('unreachable');
        return KEYSETS;
      }
    },
    getDecodedToken: vi.fn((token, keysets) => {
      if (!keysets || !keysets.length) {
        throw new Error('A short keyset ID v2 was encountered, but got no keysets to map it to.');
      }
      return {
        mint: 'https://testnut.cashu.space',
        proofs: [{ amount: 8, secret: 's', C: 'c', id: '009a1f293253e41e' }],
      };
    }),
  };
});

const i18n = (k) => k;
const OPTION = { url: 'https://mint.coinos.io', metric: 'bytes', step_size: 22020096 };

describe('validateToken resolves short keyset ids', () => {
  it('is async and validates a token given an access-option object', async () => {
    const { validateToken } = await import('../src/helpers/cashu.js');
    const r = validateToken('cashuBvalidtoken', OPTION, i18n);
    expect(r).toBeInstanceOf(Promise);
    const out = await r;
    expect(out.status).toBe(1);
    expect(out.value.amount).toBe(8);
  });

  it('passes keysets, not a bare url, to getDecodedToken', async () => {
    const { getDecodedToken } = await import('@cashu/cashu-ts');
    const { validateToken } = await import('../src/helpers/cashu.js');
    await validateToken('cashuBvalidtoken', OPTION, i18n);
    const [, keysets] = getDecodedToken.mock.calls.at(-1);
    expect(Array.isArray(keysets)).toBe(true);
    expect(keysets[0].id).toBe('009a1f293253e41e');
  });

  it('stays CU102 when no candidate mint can decode it', async () => {
    const { getDecodedToken } = await import('@cashu/cashu-ts');
    const { validateToken } = await import('../src/helpers/cashu.js');
    getDecodedToken.mockImplementationOnce(() => { throw new Error('nope'); });
    const r = await validateToken('cashuBbad', { url: 'https://dead.mint' }, i18n);
    expect(r.status).toBe(0);
    expect(r.code).toBe('CU102');
  });

  it('still reports CU101 for a non-cashu string', async () => {
    const { validateToken } = await import('../src/helpers/cashu.js');
    const r = await validateToken('not-a-token', OPTION, i18n);
    expect(r.code).toBe('CU101');
  });

  it('still reports CU100 for an empty string', async () => {
    const { validateToken } = await import('../src/helpers/cashu.js');
    const r = await validateToken('   ', OPTION, i18n);
    expect(r.code).toBe('CU100');
  });
  // Regression: candidates were read off the i18n translation FUNCTION, which carries
  // no mint list, so only the selected mint was ever tried and a note from any other
  // advertised mint still failed as CU102. The candidate set must come from the
  // caller's access options.
  it('tries every advertised mint passed as candidates', async () => {
    const { CashuMint, getDecodedToken } = await import('@cashu/cashu-ts');
    const { validateToken } = await import('../src/helpers/cashu.js');
    const tried = [];
    // Each mint has its OWN keyset id, so a wrong mint cannot accidentally decode.
    CashuMint.prototype.getKeySets = async function () {
      tried.push(this.url);
      return { keysets: [{ id: 'ks:' + this.url, unit: 'sat', active: true }] };
    };
    getDecodedToken.mockImplementation((tok, keysets) => {
      if (!keysets?.length) throw new Error('no keysets');
      // only the token's real mint decodes
      if (keysets[0].id !== 'ks:https://testnut.cashu.space') throw new Error('wrong keyset');
      return { mint: 'https://testnut.cashu.space', proofs: [{ amount: 4, secret: 's', C: 'c', id: 'ks:https://testnut.cashu.space' }] };
    });
    const opts = [
      { url: 'https://mint.a' },
      { url: 'https://mint.b' },
      { url: 'https://testnut.cashu.space' },
    ];
    // selected mint is NOT the token's mint
    const r = await validateToken('cashuBvalidtoken', opts[0], i18n, opts);
    expect(r.status).toBe(1);
    expect(tried).toEqual(['https://mint.a', 'https://mint.b', 'https://testnut.cashu.space']);
  });
});
