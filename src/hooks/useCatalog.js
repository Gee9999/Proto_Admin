import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
import { readApiJson } from '../lib/apiError';

export const CATALOG_STATUSES = ['live', 'archived', 'recycle'];

export function buildCatalogParams({
  status = 'live',
  page = 1,
  pageSize = 50,
  search = '',
  categoryPath = [],
  // Default to most-recently-edited first (updated_at desc) so a product you
  // just edited or moved to archive jumps to the top of the list. The
  // archive_product / unarchive_product RPCs stamp updated_at = now() on
  // move, so archived + restored rows surface too. Pass sort explicitly to
  // override (e.g. 'title' for alphabetical).
  sort = 'updated',
  stockFilter,
  archivedSource,
  onlyInStock = false,
  availableNowOnly = false,
  toOrderOnly = false,
} = {}) {
  return {
    status,
    page,
    pageSize,
    search,
    categoryPath,
    sort,
    stockFilter,
    archivedSource,
    onlyInStock,
    availableNowOnly,
    toOrderOnly,
  };
}

async function fetchCatalog(params) {
  const qs = new URLSearchParams({
    status: params.status,
    page: String(params.page),
    pageSize: String(params.pageSize),
    sort: params.sort || 'updated',
  });
  if (params.search) qs.set('search', params.search);
  if (params.categoryPath?.length) qs.set('categoryPath', JSON.stringify(params.categoryPath));
  if (params.stockFilter) qs.set('stockFilter', params.stockFilter);
  if (params.archivedSource && params.archivedSource !== 'all') qs.set('archivedSource', params.archivedSource);
  if (params.onlyInStock) qs.set('onlyInStock', 'true');
  if (params.availableNowOnly) qs.set('availableNowOnly', 'true');
  if (params.toOrderOnly) qs.set('toOrderOnly', 'true');
  try {
    const res = await fetch(`/api/catalog?${qs}`);
    return readApiJson(res, { fallback: 'Catalog fetch failed — try Refresh' });
  } catch (err) {
    if (err.message?.includes('fetch') || err.name === 'TypeError') {
      throw new Error('Failed to fetch catalogue — server may be busy; try Refresh');
    }
    throw err;
  }
}

/** Fetch every row matching catalog filters — parallel after page 1 knows the total. */
export async function fetchAllCatalogRows(params) {
  const pageSize = 200;
  const firstPage = await fetchCatalog({ ...params, page: 1, pageSize });
  const first = firstPage.rows || [];

  // Server tells us `total`; use it to skip the sequential poll and fetch the
  // remaining pages concurrently. Falls back to sequential if the total is
  // missing (older API shape) or unreliable.
  const total = Number(firstPage.total) || 0;
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;

  if (totalPages <= 1 || !firstPage.hasMore) return first;

  // Bound concurrency so we don't fan out unbounded when a category has
  // thousands of items. 4 in parallel is well within Supabase's pooler.
  const CONCURRENCY = 4;
  const remainingPages = [];
  for (let p = 2; p <= totalPages; p += 1) remainingPages.push(p);

  const buckets = new Array(totalPages);
  buckets[0] = first;
  let cursor = 0;
  async function worker() {
    while (cursor < remainingPages.length) {
      const idx = cursor;
      cursor += 1;
      const page = remainingPages[idx];
      const json = await fetchCatalog({ ...params, page, pageSize });
      buckets[page - 1] = json.rows || [];
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, remainingPages.length) }, worker));

  const all = [];
  for (const bucket of buckets) {
    if (bucket) all.push(...bucket);
  }
  return all;
}

export function useCatalogQuery(params, { enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.catalog(params),
    queryFn: () => fetchCatalog(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    enabled,
  });
}

export function useTaxonomyQuery() {
  return useQuery({
    queryKey: queryKeys.taxonomy(),
    queryFn: async () => {
      const res = await fetch('/api/taxonomy');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Taxonomy fetch failed');
      return json.categories || json;
    },
    staleTime: 5 * 60_000,
  });
}
