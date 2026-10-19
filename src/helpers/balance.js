// helpers/balance.js
//
// Thin "internet balance" layer for the captive portal.
//
// IMPORTANT: this does NOT fabricate a balance backend. A user's "internet
// balance" is the time/bytes a given Cashu token grants against the selected
// mint, computed with the SAME validation + allocation helpers the purchase
// flow uses. This keeps the balance page truthful — it only ever reports
// values derived from a real token and the net4sats's real pricing event.

// helpers (real implementations)
import { validateToken } from './cashu';
import { calculateAllocation, getnet4satsBaseUrl } from './net4sats';

// Compute the internet balance a Cashu token represents for a given mint.
//
// @param {string}  token - a cashu token string
// @param {object}  mint  - a mint/access-option object (from getAccessOptions)
// @param {function} i18n - translation function
// @returns {object} { status: 1, value: { amount, unit, allocation: {value, unit} } }
//                    or { status: 0, code, label, message } when the token is invalid
export const getInternetBalance = async (token, mint, i18n, candidates = []) => {
  // validate the token first (format, decode, proof sum, mint match)
  const validation = await validateToken(token, mint, i18n, candidates);
  if (!validation.status) {
    return validation;
  }

  // derive the internet balance (time/bytes) the token grants
  return {
    status: 1,
    value: {
      amount: validation.value.amount,
      unit: validation.value.unit,
      allocation: calculateAllocation(validation.value.amount, mint, i18n),
    },
  };
};

// Format an allocation object ({ value, unit }) into a single readable string,
// e.g. { value: 10, unit: 'min' } -> "10 min".
export const formatBalance = (allocation) => {
  if (!allocation || allocation.value == null) {
    return '';
  }
  return `${allocation.value} ${allocation.unit}`;
};

// The balance endpoint is served by the ROUTER API, not by the portal's static
// docroot. A relative '/balance' resolves against the portal origin (:2051), where
// uhttpd has no such route, so it 404s and the page always reported
// "Balance unavailable". Resolve the API origin the same way the purchase flow does.
export const fetchBalanceData = async (i18n) => {
  try {
    const resp = await fetch(`${getnet4satsBaseUrl()}/balance`);
    if (!resp.ok) return { status: 0, code: 'network', message: 'Balance unavailable' };
    const data = await resp.json();
    return { status: 1, value: data };
  } catch {
    return { status: 0, code: 'network', message: 'Balance unavailable' };
  }
};

export const formatMetricValue = (amount, metric) => {
  if (!amount && amount !== 0) return '—';
  if (metric === 'bytes') {
    if (amount >= 1073741824) return (amount / 1073741824).toFixed(1) + ' GB';
    if (amount >= 1048576) return (amount / 1048576).toFixed(1) + ' MB';
    if (amount >= 1024) return (amount / 1024).toFixed(0) + ' KB';
    return amount + ' B';
  }
  const seconds = Math.floor(amount / 1000);
  if (seconds >= 3600) return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
  if (seconds >= 60) return Math.floor(seconds / 60) + ' min';
  return seconds + 's';
};

export const getMetricLabel = (metric, t) => {
  return metric === 'bytes' ? (t ? t('balance_data') : 'Data') : (t ? t('balance_time') : 'Time');
};
