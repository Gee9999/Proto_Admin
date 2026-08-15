import { createClient } from '@supabase/supabase-js';
import { requireOwner } from './_admin-auth.js';
import { fetchProductLookupMap, findProductBySku } from './_sku-match.js';
import { resolveProductByCode } from './_sql-provider.js';
import { canonicalPublishValues } from '../lib/catalogue-safety.mjs';
import { normalizeUnitsOfIssue } from '../lib/selling-unit.mjs';
import { logProductLoaderAudit } from './_product-loader-audit.js';

const ARCHIVED_BY = 'excel-images';
const SLOT_FIELDS = ['image_url_one', 'image_url_two', 'image_url_three', 'image_url_four'];

function getStockClient() {
  return createClient(
    process.env.VITE_STOCK_SUPABASE_URL,
    process.env.VITE_STOCK_SUPABASE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export default async function handler(req, res) {
  if (!(await requireOwner(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const sku = String(body.sku || body.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const barcode = String(body.barcode || '').trim().toUpperCase();
  const title = String(body.title || '').trim();
  const images = Array.isArray(body.images) ? body.images : [];
  if (!sku || !barcode || !title) return res.status(400).json({ error: 'SKU, barcode and title are required' });

  const imageFields = {};
  for (const image of images) {
    const slot = Math.min(4, Math.max(1, Number(image?.slot) || 0));
    const url = String(image?.url || '').trim();
    if (slot && url) imageFields[SLOT_FIELDS[slot - 1]] = url;
  }
  if (!imageFields.image_url_one) return res.status(400).json({ error: 'A main image is required' });

  const sb = getStockClient();
  try {
    const [{ data: live, error: liveError }, { data: archived, error: archivedError }] = await Promise.all([
      sb.from('website_stock').select('sku').eq('sku', sku).maybeSingle(),
      sb.from('archived_products').select('sku').eq('sku', sku).maybeSingle(),
    ]);
    if (liveError || archivedError) throw liveError || archivedError;
    if (live || archived) {
      return res.status(409).json({
        error: `SKU "${sku}" already exists ${live ? 'on the website' : 'in Archive'}. Nothing was overwritten.`,
        code: 'exists',
      });
    }

    const productMap = await fetchProductLookupMap(
      sb,
      [barcode],
      'sku, sell_price, stock_qty, available_stock, units_of_issue',
    );
    const canonical = findProductBySku(productMap, barcode);
    if (!canonical) {
      return res.status(422).json({ error: `Barcode "${barcode}" was not found in the product source.`, code: 'barcode_not_found' });
    }
    const positill = await resolveProductByCode(barcode).catch(() => ({ product: null, dataSource: null }));
    const safeValues = canonicalPublishValues({
      product: canonical,
      livePositill: positill.product,
      positillSource: positill.dataSource,
      existing: null,
      submitted: { price: body.price, stockQty: body.stockQty, availableStock: body.availableStock },
      priceBasis: 'vat_inclusive',
    });
    if (safeValues.blocked) return res.status(422).json({ error: safeValues.message, code: safeValues.code });

    const now = new Date().toISOString();
    const payload = {
      sku,
      barcode,
      title,
      original_description: String(body.description || '').trim() || title,
      price: safeValues.price,
      stock_qty: safeValues.stockQty,
      available_stock: safeValues.availableStock,
      units_of_issue: normalizeUnitsOfIssue(body.unitsOfIssue || canonical.units_of_issue || 'EACH'),
      category: 'Uncategorised',
      subcategory_one: 'General',
      ...imageFields,
      archived_by: ARCHIVED_BY,
      archived_at: now,
      updated_at: now,
    };
    const { error } = await sb.from('archived_products').insert(payload);
    if (error) throw error;

    await logProductLoaderAudit(sb, {
      sku,
      action: 'create',
      source: 'excel_local_images',
      publishMode: 'archive',
      imageSlot: 1,
      imageSource: 'upload',
      newValues: { outcome: 'archived', archivedBy: ARCHIVED_BY, barcode, title, imageCount: Object.keys(imageFields).length },
      publishedBy: String(body.publishedBy || '').trim() || null,
    });
    return res.status(200).json({ ok: true, sku, action: 'archived', archivedBy: ARCHIVED_BY });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Could not send product to Archive' });
  }
}
