// external
import { getDecodedToken, CashuMint } from "@cashu/cashu-ts";
import { getPublicKey, getEventHash, getSignature } from "nostr-tools";

// helpers
import { getnet4satsBaseUrl } from "./net4sats";

// safely extract proofs from a decoded token, handling different possible token formats
export const extractProofsFromToken = (decodedToken) => {
  const proofs = [];

  try {
    // handle token array format
    if (decodedToken.token && Array.isArray(decodedToken.token)) {
      decodedToken.token.forEach((t) => {
        if (t.proofs && Array.isArray(t.proofs)) {
          proofs.push(...t.proofs);
        }
      });
    }
    // handle single token format
    else if (decodedToken.token && decodedToken.token.proofs) {
      proofs.push(...decodedToken.token.proofs);
    }
    // handle direct token structure
    else if (decodedToken.proofs && Array.isArray(decodedToken.proofs)) {
      proofs.push(...decodedToken.proofs);
    }
    // handle token with tokens array
    else if (decodedToken.tokens && Array.isArray(decodedToken.tokens)) {
      decodedToken.tokens.forEach((t) => {
        if (t.proofs && Array.isArray(t.proofs)) {
          proofs.push(...t.proofs);
        }
      });
    }
  } catch (error) {
    // log and ignore extraction errors
    console.error("error extracting proofs:", error);
  }

  return proofs;
};

// A modern cashu token carries SHORT keyset ids, which cashu-ts can only decode when
// it is given the mint's keysets. Called without them it throws
//   "A short keyset ID v2 was encountered, but got no keysets to map it to."
// which the portal reported as CU102 for EVERY valid token, from any mint.
//
// There is a chicken-and-egg here: getDecodedToken throws before revealing the token's
// mint, so the mint cannot be read out of the token first. Instead try a candidate
// list — the selected option first, then the portal's other mints — and accept the
// first keysets that decode. Results (keysets and the winning mint) are cached.
const keysetCache = new Map();

// The portal's access options are OBJECTS ({ url, metric, step_size, ... }); the
// helper also has to tolerate a bare URL string from other call sites.
const toMintUrl = (m) => {
  if (!m) return null;
  if (typeof m === "string") return m;
  if (typeof m === "object" && typeof m.url === "string") return m.url;
  return null;
};

const getKeysetsFor = async (mintUrl) => {
  if (!mintUrl) return [];
  if (keysetCache.has(mintUrl)) return keysetCache.get(mintUrl);
  try {
    const res = await new CashuMint(mintUrl).getKeySets();
    const list = Array.isArray(res) ? res : res?.keysets || [];
    keysetCache.set(mintUrl, list);
    return list;
  } catch (err) {
    // An unreachable mint must not turn a good token into CU104.
    console.warn("could not fetch mint keysets:", mintUrl, err?.message || err);
    keysetCache.set(mintUrl, []);
    return [];
  }
};

// Try the selected mint, then the other options, then any mint the token names.
// Returns { decoded, mintUrl } or null.
const decodeWithAnyMint = async (raw, mint, candidates = []) => {
  const seen = new Set();
  const urls = [];
  const add = (m) => { const u = toMintUrl(m); if (u && !seen.has(u)) { seen.add(u); urls.push(u); } };
  add(mint);
  // NOTE: candidates must come from the caller. `i18n` is the translation FUNCTION,
  // not a carrier of the mint list; reading options off it silently yielded only the
  // selected mint, so a note from any other mint still failed to decode.
  candidates.forEach(add);
  for (const url of urls) {
    const keysets = await getKeysetsFor(url);
    if (!keysets.length) continue;
    try {
      return { decoded: getDecodedToken(raw, keysets), mintUrl: url };
    } catch { /* wrong mint, or not this token's keysets: try the next */ }
  }
  return null;
};

// validate a cashu token: check format, decode, extract proofs, and sum value
export const validateToken = async (token = "", mint, i18n, candidates = []) => {
  try {
    // check for empty or non-string token
    if ("string" !== typeof token || !token.trim()) {
      return {
        status: 0,
        code: "CU100",
        label: i18n("CU100_label"),
        message: i18n("CU100_message"),
      };
    }

    // basic validation - cashu tokens should start with "cashu"
    if (!token.trim().startsWith("cashu")) {
      return {
        status: 0,
        code: "CU101",
        label: i18n("CU101_label"),
        message: i18n("CU101_message"),
      };
    }

    // attempt to decode the token using the getDecodedToken method
    let decodedToken = null;
    try {
      const raw = token.trim();
      const hit = await decodeWithAnyMint(raw, mint, candidates);
      if (hit) {
        decodedToken = hit.decoded;
      } else {
        // Last resort: decode without keysets. Succeeds for legacy (long id) tokens
        // and fails for modern ones, which is the honest outcome.
        decodedToken = getDecodedToken(raw, await getKeysetsFor(toMintUrl(mint)));
      }
      if (!decodedToken) {
        return {
          status: 0,
          code: "CU102",
          label: i18n("CU102_label"),
          message: i18n("CU102_message"),
        };
      }
    } catch (err) {
      return {
        status: 0,
        code: "CU102",
        label: i18n("CU102_label"),
        message: i18n("CU102_message"),
      };
    }

    // extract proofs from the token
    const proofs = extractProofsFromToken(decodedToken);
    if (!proofs || proofs.length === 0) {
      return {
        status: 0,
        code: "CU103",
        label: i18n("CU103_label"),
        message: i18n("CU103_message"),
      };
    }

    // calculate the sum of proof values
    const totalAmount = proofs.reduce((sum, proof) => {
      const proofAmount = Number(proof.amount || 0);
      return sum + proofAmount;
    }, 0);

    // todo: check if token unit matches mint unit

    // return the token value with proof details
    return {
      status: 1,
      value: {
        isValid: true,
        hasProofs: true,
        amount: totalAmount,
        proofCount: proofs.length,
        unit: "sat",
      },
    };
  } catch (error) {
    // catch and report unexpected errors
    console.error("error decoding token:", error);
    return {
      status: 0,
      code: "CU104",
      label: i18n("CU104_label"),
      message: i18n("CU104_message"),
    };
  }
};

// submit a cashu token to the net4sats backend for payment
export const submitToken = async (token, net4satsDetails, allocation, i18n) => {
  try {
    // get net4sats pubkey from event
    const net4satsPubkey = net4satsDetails.detailsEvent.pubkey;
    // generate a random private key for signing
    const privateKeyBytes = window.crypto.getRandomValues(new Uint8Array(32));
    const privateKeyHex = Array.from(privateKeyBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // generate the pubkey from private key using nostr-tools
    let pubkey;
    try {
      pubkey = getPublicKey(privateKeyHex);
    } catch (error) {
      // failed to generate pubkey
      console.error("error getting public key:", error);
      return {
        status: 0,
        code: "CU105",
        label: i18n("CU105_label"),
        message: i18n("CU105_message"),
      };
    }

    // create the nostr event according to tip-01 spec
    const unsignedEvent = {
      kind: 21000,
      pubkey: pubkey,
      content: "",
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["p", net4satsPubkey],
        [
          "device-identifier",
          net4satsDetails.deviceInfo.type,
          net4satsDetails.deviceInfo.value,
        ],
        ["payment", token],
      ],
    };

    // calculate the event hash (id)
    const id = getEventHash(unsignedEvent);

    // sign the event using signEvent, which is still available
    const sig = getSignature(unsignedEvent, privateKeyHex);

    // create a clean event object for sending
    const event = {
      ...unsignedEvent,
      id,
      sig,
    };

    console.log("sending signed event:", event);

    // send the event to the net4sats server
    const baseUrl = getnet4satsBaseUrl();
    const response = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      if (response.status === 402) {
        // payment required: token was not accepted
        console.error("error processing token:", response);
        return {
          status: 0,
          code: "CU106",
          label: i18n("CU106_label"),
          message: i18n("CU106_message"),
        };
      } else {
        // other server error
        console.error("server error:", response);
        return {
          status: 0,
          code: "CU107",
          label: i18n("CU107_label"),
          message: i18n("CU107_message"),
        };
      }
    }

    // payment was successful
    return {
      status: 1,
      label: i18n("access_granted_title"),
      message: i18n("access_granted_subtitle", { purchased: allocation }),
    };
  } catch (error) {
    // catch and report unexpected errors
    console.error("error sending token:", error);
    return {
      status: 0,
      code: "CU108",
      label: i18n("CU108_label"),
      message: i18n("CU108_message"),
    };
  }
};
