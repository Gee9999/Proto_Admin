/**
 * Deterministic, advisory matching of an online application to the imported
 * Positill customer snapshot. This module never links or mutates records.
 */

function asText(value) { return String(value ?? '').trim(); }

export function normalizeCode(value) {
  return asText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function normalizeEmail(value) {
  return asText(value).toLowerCase();
}

export function normalizePhone(value) {
  const digits = asText(value).replace(/\D/g, '');
  if (!digits) return '';
  // Compare South African numbers consistently (local 0xx vs +27xx).
  if (digits.startsWith('27') && digits.length >= 11) return `0${digits.slice(2)}`;
  return digits;
}

export function normalizeCompany(value) {
  return asText(value)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

const FIELD_RULES = [
  { key: 'code', label: 'Customer code', weight: 100, normalize: normalizeCode, application: ['claimed_customer_code', 'customer_code'], candidate: ['account_code', 'customer_code', 'code'] },
  { key: 'email', label: 'Email address', weight: 95, normalize: normalizeEmail, application: ['email'], candidate: ['email'] },
  { key: 'phone', label: 'Phone number', weight: 90, normalize: normalizePhone, application: ['phone'], candidate: ['phone'] },
  { key: 'company', label: 'Business name', weight: 80, normalize: normalizeCompany, application: ['business_name', 'name'], candidate: ['name', 'business_name', 'company_name'] },
];

function firstValue(row, keys) {
  for (const key of keys) {
    const value = asText(row?.[key]);
    if (value) return value;
  }
  return '';
}

export function scorePositillCandidate(application = {}, candidate = {}) {
  const evidence = [];
  for (const rule of FIELD_RULES) {
    const left = rule.normalize(firstValue(application, rule.application));
    const right = rule.normalize(firstValue(candidate, rule.candidate));
    if (left && right && left === right) {
      evidence.push({ field: rule.key, label: rule.label, value: firstValue(candidate, rule.candidate), weight: rule.weight });
    }
  }
  const score = evidence.reduce((highest, item) => Math.max(highest, item.weight), 0)
    + (evidence.length > 1 ? Math.min(10, (evidence.length - 1) * 5) : 0);
  const confidence = score >= 90 ? 'high' : score >= 75 ? 'medium' : score >= 55 ? 'low' : 'none';
  return { score, confidence, evidence };
}

export function matchPositillCandidates(application = {}, candidates = []) {
  const matches = candidates
    .map((candidate) => ({ candidate, ...scorePositillCandidate(application, candidate) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || String(a.candidate.id || '').localeCompare(String(b.candidate.id || '')));
  const topScore = matches[0]?.score || 0;
  const top = matches.filter((match) => match.score === topScore);
  return {
    matches: matches.slice(0, 10),
    // Account codes are not globally unique in the imported allowlist; an
    // exact code match can therefore still be ambiguous without corroboration.
    ambiguous: top.length > 1,
    recommendation: top.length === 1 && top[0].confidence === 'high' ? 'review_high_confidence_match' : 'manual_review',
  };
}

export const MATCH_FIELDS = Object.freeze(FIELD_RULES.map(({ key, label, weight }) => ({ key, label, weight })));
