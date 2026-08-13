import { findProductBySku, fetchProductLookupMap } from './_sku-match.js';
import { resolveProductByCode } from './_sql-provider.js';
import { customerPriceFromPositill } from '../lib/catalogue-price.mjs';

function readNum(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Map a website_stock / archived_products / website_products row → products upsert payload. */
export function catalogueRowToProductPayload(row) {
  const sku = String(row.barcode || row.product_sku || row.sku || '').trim();
  if (!sku) return null;
  return {
    sku,
    description: String(row.original_description || row.description || row.title || sku).trim(),
    sell_price: readNum(row.sell_price ?? row.price, 0),
    stock_qty: readNum(row.stock_qty ?? row.available_stock, 0),
    available_stock: readNum(row.available_stock ?? row.stock_qty, 0),
    units_of_issue: String(row.units_of_issue || 'EACH').trim() || 'EACH',
    updated_at: new Date().toISOString(),
  };
}

/**
 * Ensure public.products has a row for this catalogue item (SOH source of truth).
 * Never overwrites an existing ERP row — only inserts when missing.
 */
export async function ensureProductFromCatalogueRow(supabase, row) {
  const payload = catalogueRowToProductPayload(row);
  if (!payload) return { ok: false, reason: 'missing_sku' };

  const lookup = await fetchProductLookupMap(supabase, [payload.sku], 'sku, sell_price, stock_qty, available_stock');
  const existing = findProductBySku(lookup, payload.sku);
  if (existing) return { ok: true, sku: existing.sku, created: false, existing: true };

  const { error } = await supabase.from('products').insert(payload);
  if (error) throw error;
  return { ok: true, sku: payload.sku, created: true, existing: false };
}

/** Format a failed sync step as "step: message" for a syncWarnings entry. */
export function formatSyncWarning(step, error) {
  const message = String(error?.message || error || 'unknown error').trim() || 'unknown error';
  return `${step}: ${message}`;
}

/**
 * Convert a verified live Positill row into the values safe to restore to the
 * customer website. Archive prices are historical snapshots and must never be
 * reused as the publication authority.
 */
export function archivedRestoreValues(liveProduct, dataSource) {
  if (dataSource !== 'erp_sql' || !liveProduct) {
    throw new Error('Make Live paused because the current Positill price could not be verified. Retry when Live Positill SQL is connected.');
  }

  const price = customerPriceFromPositill(liveProduct.price);
  if (!(price > 0)) {
    throw new Error('Make Live paused because Positill returned a zero or invalid price. Correct the price in Positill and retry.');
  }

  const stockQty = readNum(liveProduct.onhand, 0);
  const availableStock = readNum(liveProduct.available, stockQty);
  return { price, stockQty, availableStock };
}

/** Pick the richest catalogue row per ERP barcode (live preferred over archive). */
export function groupCatalogueRowsByErpKey(rows, { preferLiveSkus = null } = {}) {
  const liveSet = preferLiveSkus instanceof Set ? preferLiveSkus : new Set();
  const byKey = new Map();

  for (const row of rows) {
    const key = String(row.barcode || row.product_sku || row.sku || '').trim();
    if (!key) continue;

    const score = (r) => {
      let s = 0;
      if (liveSet.has(r.sku)) s += 100;
      const soh = readNum(r.available_stock ?? r.stock_qty, -999999);
      s += soh;
      const price = readNum(r.price ?? r.sell_price, 0);
      if (price > 0) s += 10;
      if (r.original_description || r.description) s += 1;
      return s;
    };

    const prev = byKey.get(key);
    if (!prev || score(row) >= score(prev)) byKey.set(key, row);
  }

  return byKey;
}

/**
 * Move archived_products row → website_stock with ERP + SOH bridge wired up.
 *
 * keepLiveWhenOos (default true): an explicit make-live is a deliberate decision
 * to publish, so we stamp keep_live_when_oos = true before the visibility sync
 * runs. Otherwise sync_website_from_products (migration 018's auto-OOS rule)
 * re-archives any just-restored row whose ERP stock isn't positive yet —
 * silently undoing the publish so the product never becomes viewable to
 * customers. Pass false only for callers that want the auto-OOS rule to apply.
 */
export async function restoreArchivedToLive(supabase, sku, { keepLiveWhenOos = true } = {}) {
  const cleanSku = String(sku || '').trim();
  if (!cleanSku) throw new Error('sku required');

  const { data: archived, error: archErr } = await supabase
    .from('archived_products')
    .select('*')
    .eq('sku', cleanSku)
    .maybeSingle();
  if (archErr) throw archErr;

  if (!archived) {
    const { data: live } = await supabase.from('website_stock').select('sku').eq('sku', cleanSku).maybeSingle();
    if (live) return { ok: true, sku: cleanSku, alreadyLive: true, syncWarnings: [] };
    throw new Error('Product not in archive');
  }

  if (archived.archived_by === 'new-products') {
    throw new Error('New product preview — use Approval → Set live');
  }

  // An archived row is a historical snapshot. Verify the current live ERP
  // value before changing either table, then replace its stale price/stock so
  // unarchive_product cannot copy an old value back onto the website.
  const erpCode = String(archived.barcode || archived.product_sku || archived.sku || '').trim();
  const liveResolution = await resolveProductByCode(erpCode).catch(() => ({
    product: null,
    dataSource: null,
    bridgeAttempted: true,
  }));
  const liveValues = archivedRestoreValues(liveResolution.product, liveResolution.dataSource);
  const { error: refreshArchiveErr } = await supabase
    .from('archived_products')
    .update({
      price: liveValues.price,
      stock_qty: liveValues.stockQty,
      available_stock: liveValues.availableStock,
      updated_at: new Date().toISOString(),
    })
    .eq('sku', cleanSku);
  if (refreshArchiveErr) throw refreshArchiveErr;

  const refreshedArchived = {
    ...archived,
    price: liveValues.price,
    stock_qty: liveValues.stockQty,
    available_stock: liveValues.availableStock,
  };

  await ensureProductFromCatalogueRow(supabase, refreshedArchived);

  const { error: unErr } = await supabase.rpc('unarchive_product', { p_sku: cleanSku });
  if (unErr) throw unErr;

  // Post-restore sync RPC failures leave the product half-restored (unarchived
  // but not synced to the storefront). The restore itself succeeded, so still
  // return ok: true — but collect each failure so callers can warn the admin
  // instead of silently dropping it.
  const syncWarnings = [];

  const { error: upsertErr } = await supabase.rpc('upsert_website_product_from_stock', { p_website_sku: cleanSku });
  if (upsertErr) {
    console.warn('upsert_website_product_from_stock:', upsertErr.message);
    syncWarnings.push(formatSyncWarning('upsert_website_product_from_stock', upsertErr));
  }

  // Set the keep-live flag AFTER the upsert (which could reset it) and BEFORE
  // the visibility sync (which reads it), so an explicit publish survives the
  // auto-OOS rule even when the product has no ERP stock yet.
  if (keepLiveWhenOos) {
    const { error: keepErr } = await supabase
      .from('website_stock')
      .update({ keep_live_when_oos: true, updated_at: new Date().toISOString() })
      .eq('sku', cleanSku);
    if (keepErr) {
      console.warn('restoreArchivedToLive keep_live_when_oos:', keepErr.message);
      // Without this flag the next visibility sync re-hides a zero-stock
      // product — the exact "half-restored silently" failure syncWarnings
      // exists to surface.
      syncWarnings.push(formatSyncWarning('keep_live_when_oos', keepErr));
    }
  }

  const { data: syncResult, error: syncErr } = await supabase.rpc('sync_website_from_products');
  if (syncErr) {
    console.warn('sync_website_from_products:', syncErr.message);
    syncWarnings.push(formatSyncWarning('sync_website_from_products', syncErr));
  }

  // General product synchronisation may still carry an older cached price.
  // Enforce the verified live value last, then refresh the public storefront
  // projection once more. A failure is fatal: reporting success with the old
  // archive price would be worse than making the admin retry.
  const { data: corrected, error: correctErr } = await supabase
    .from('website_stock')
    .update({
      price: liveValues.price,
      stock_qty: liveValues.stockQty,
      available_stock: liveValues.availableStock,
      updated_at: new Date().toISOString(),
    })
    .eq('sku', cleanSku)
    .select('sku');
  if (correctErr) throw correctErr;
  if (!corrected?.length) throw new Error('Restored product could not be verified in the live catalogue');

  const { error: finalUpsertErr } = await supabase.rpc('upsert_website_product_from_stock', { p_website_sku: cleanSku });
  if (finalUpsertErr) throw finalUpsertErr;

  return {
    ok: true,
    sku: cleanSku,
    price: liveValues.price,
    priceSource: 'positill.live_price_a_ex_vat_converted',
    sync: syncResult,
    syncWarnings,
  };
}
