export const ARCHIVE_PRIORITY_STORAGE_KEY = 'proto-archive-excel-priority-v1';
export const ARCHIVE_PRIORITY_MAX = 100;
export const ARCHIVE_PRIORITY_TTL_MS = 24 * 60 * 60 * 1000;

const cleanSku = (value) => String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');

export function normalizeArchivePrioritySkus(values) {
  const unique = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const sku = cleanSku(value);
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    unique.push(sku);
    if (unique.length >= ARCHIVE_PRIORITY_MAX) break;
  }
  return unique;
}

export function prioritizeRowsBySku(rows, prioritySkus) {
  const rank = new Map(normalizeArchivePrioritySkus(prioritySkus).map((sku, index) => [sku, index]));
  if (!rank.size) return rows;
  return [...(rows || [])].sort((a, b) => {
    const aRank = rank.get(cleanSku(a?.sku));
    const bRank = rank.get(cleanSku(b?.sku));
    if (aRank == null && bRank == null) return 0;
    if (aRank == null) return 1;
    if (bRank == null) return -1;
    return aRank - bRank;
  });
}

export function saveArchivePrioritySkus(values) {
  const skus = normalizeArchivePrioritySkus(values);
  try {
    localStorage.setItem(ARCHIVE_PRIORITY_STORAGE_KEY, JSON.stringify({
      skus,
      savedAt: Date.now(),
    }));
  } catch { /* local storage may be unavailable */ }
  return skus;
}

export function readArchivePrioritySkus() {
  try {
    const stored = JSON.parse(localStorage.getItem(ARCHIVE_PRIORITY_STORAGE_KEY) || 'null');
    if (Array.isArray(stored)) return normalizeArchivePrioritySkus(stored);
    if (!stored || !Array.isArray(stored.skus)) return [];

    const savedAt = Number(stored.savedAt);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > ARCHIVE_PRIORITY_TTL_MS) {
      localStorage.removeItem(ARCHIVE_PRIORITY_STORAGE_KEY);
      return [];
    }
    return normalizeArchivePrioritySkus(stored.skus);
  } catch {
    return [];
  }
}
