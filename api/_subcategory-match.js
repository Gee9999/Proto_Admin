import { loadBundledTaxonomy } from './_taxonomy-utils.js';

const STOP = new Set(['and', 'the', 'or', 'in', 'of', 'for', 'a', 'an', 'subcategory', 'category']);

function flattenNodes(nodes) {
  const flat = [];
  for (const n of nodes || []) {
    flat.push({ id: n.id, label: n.label });
    if (n.children?.length) flat.push(...flattenNodes(n.children));
  }
  return flat;
}

const TAXONOMY_NODES = flattenNodes(loadBundledTaxonomy());

/** All taxonomy labels for lookup routing hints. */
export function getTaxonomySubcategoryLabels() {
  return TAXONOMY_NODES.map((n) => n.label);
}

/** Strip routing fluff so "fix all images on canvases and surfaces subcategory" → "canvases and surfaces". */
export function cleanBatchTerms(terms) {
  let t = String(terms || '').trim();
  t = t.replace(/^(fix|reprocess|do|run)\s+(all\s+)?(the\s+)?images?\s+(on|in|for|from)\s+(the\s+)?/i, '');
  t = t.replace(/^(image gen|image generation)\s+(on|for|in)\s+(the\s+)?/i, '');
  t = t.replace(/\b(subcategory|category)\b/gi, ' ');
  t = t.replace(/^the\s+/i, '').replace(/\s+(subcategory|category)\s*$/i, '').replace(/\s+/g, ' ').trim();
  return t;
}

/**
 * Split "Canvases, Spray Paint" or "canvases and spray paint" into separate subcategory phrases.
 * Does NOT split "games and puzzles" when it's a single taxonomy label (no comma).
 */
export function splitBatchTermPhrases(terms) {
  const cleaned = cleanBatchTerms(terms);
  if (!cleaned) return [];

  if (/[,;]/.test(cleaned)) {
    return cleaned.split(/\s*[,;]\s*/).map((p) => p.trim()).filter(Boolean);
  }

  // "canvases and spray paint" as two distinct subcategories (both resolve in taxonomy)
  const andParts = cleaned.split(/\s+and\s+/i).map((p) => p.trim()).filter(Boolean);
  if (andParts.length > 1) {
    const resolvedCount = andParts.filter((p) => resolveTaxonomyLabels(p).length > 0).length;
    if (resolvedCount > 1) return andParts;
  }

  return [cleaned];
}

/** Pull subcategory phrase from a full user sentence when classifier terms are empty or too broad. */
export function extractSubcategoryFromQuery(query) {
  const q = String(query || '').trim();
  const patterns = [
    /(?:fix|reprocess|do|run)\s+all\s+(?:the\s+)?images?\s+(?:on|in|for|from)\s+(?:the\s+)?(.+?)(?:\s+subcategory|\s+category|\s*[-—–:]\s|\.\s|$)/i,
    /(?:images?\s+(?:on|in|for|from))\s+(?:the\s+)?(.+?)(?:\s+subcategory|\s+category|\s*[-—–:]\s|$)/i,
    /(?:subcategory|category)\s+(?:called\s+)?(.+?)(?:\s*[-—–:]\s|$)/i,
  ];
  for (const re of patterns) {
    const m = q.match(re);
    if (m?.[1]) {
      const cleaned = cleanBatchTerms(m[1]);
      if (cleaned.length >= 2) return cleaned;
    }
  }
  return '';
}

/** Tokenize for fuzzy label match — "Games & Puzzles" and "games and puzzles" → [games, puzzles] */
export function tokenizeLabel(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP.has(w));
}

function tokensMatch(needle, haystack) {
  if (!needle.length) return false;
  const hay = new Set(haystack);
  return needle.every((t) => hay.has(t));
}

/** Resolve free-text to taxonomy node labels (e.g. "games and puzzles" → "Games & Puzzles"). */
export function resolveTaxonomyLabels(terms) {
  const raw = String(terms || '').trim();
  const needle = tokenizeLabel(raw);
  if (!needle.length) return [];

  const hits = TAXONOMY_NODES.filter((node) => {
    if (node.label.toLowerCase() === raw.toLowerCase()) return true;
    const fromLabel = tokenizeLabel(node.label);
    const fromId = tokenizeLabel(node.id.replace(/-/g, ' '));
    return tokensMatch(needle, fromLabel) || tokensMatch(needle, fromId);
  });

  return [...new Set(hits.map((n) => n.label))];
}

/** Resolve labels for one or more comma-separated subcategory phrases. */
export function resolveTaxonomyLabelsMulti(terms) {
  const phrases = splitBatchTermPhrases(terms);
  const labels = phrases.flatMap((p) => resolveTaxonomyLabels(p));
  return [...new Set(labels)];
}

export function suggestSubcategories(terms, limit = 5) {
  const phrases = splitBatchTermPhrases(terms);
  const needle = tokenizeLabel(phrases.join(' '));
  if (!needle.length) return [];

  return TAXONOMY_NODES
    .map((node) => {
      const labelTokens = tokenizeLabel(node.label);
      const score = needle.filter((t) => labelTokens.includes(t)).length;
      return { label: node.label, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.label);
}

function productSubcategories(p) {
  return [p.subcategory_one, p.subcategory_two, p.subcategory_three, p.subcategory_four].filter(Boolean);
}

function labelMatchesPhrase(label, phrase) {
  const needleTokens = tokenizeLabel(phrase);
  if (!needleTokens.length) return false;

  const labelTokens = tokenizeLabel(label);
  const canonicalLabels = resolveTaxonomyLabels(phrase);

  if (tokensMatch(needleTokens, labelTokens)) return true;
  if (canonicalLabels.some((canonical) => tokensMatch(tokenizeLabel(canonical), labelTokens))) return true;

  // Case-insensitive exact label match on DB value
  if (label.trim().toLowerCase() === phrase.trim().toLowerCase()) return true;

  return false;
}

function findProductsBySubcategoryPhrase(products, phrase) {
  if (!phrase?.trim()) return [];
  return products.all.filter((p) => {
    const labels = productSubcategories(p);
    return labels.some((label) => labelMatchesPhrase(label, phrase));
  });
}

export function findProductsBySubcategory(products, terms) {
  const phrases = splitBatchTermPhrases(terms);
  if (!phrases.length) return [];

  const seen = new Set();
  const results = [];

  for (const phrase of phrases) {
    for (const p of findProductsBySubcategoryPhrase(products, phrase)) {
      if (!seen.has(p.sku)) {
        seen.add(p.sku);
        results.push(p);
      }
    }
  }

  return results;
}

/** Match products by title, SKU, barcode, or category keywords (e.g. "monttaro canvas"). */
export function findProductsByKeyword(products, terms) {
  const phrases = splitBatchTermPhrases(terms);
  const seen = new Set();
  const results = [];

  for (const phrase of phrases) {
    const needleTokens = tokenizeLabel(phrase);
    if (!needleTokens.length) continue;

    for (const p of products.all) {
      if (seen.has(p.sku)) continue;
      const hay = tokenizeLabel([
        p.title,
        p.sku,
        p.barcode,
        p.category,
        p.subcategory_one,
        p.subcategory_two,
      ].filter(Boolean).join(' '));
      if (tokensMatch(needleTokens, hay)) {
        seen.add(p.sku);
        results.push(p);
      }
    }
  }

  return results;
}
