import { createClient } from '@supabase/supabase-js';
import { requireOwner } from './_admin-auth.js';
import { isSqlConfigured } from './_sql-provider.js';
import {
  classifyBatchItem,
  fetchDormantSkuSet,
  lookupWebsiteStockExact,
  parseLoaderFilename,
  resolveProductLoaderMatch,
} from './_product-loader-lookup.js';
import { siblingSkuForCopy } from './_product-loader-filename.js';
import {
  assignColourVariantImageSlots,
  parseColourVariantFilename,
} from '../lib/product-colour-variants.mjs';

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
  if (req.method !== 'POST') return res.status(405).end();

  const { filenames, groupColourVariants = true } = req.body || {};
  if (!Array.isArray(filenames) || !filenames.length) {
    return res.status(400).json({ error: 'filenames array is required' });
  }

  const sb = getStockClient();
  const dormantSkus = await fetchDormantSkuSet(sb).catch(() => new Set());
  const items = [];
  let matched = 0;
  const groups = { ready: 0, needs_review: 0, not_found: 0 };

  const parsedRows = assignColourVariantImageSlots(
    filenames.map((filename) => ({
      filename,
      parsed: parseLoaderFilename(filename),
      colourVariant: groupColourVariants ? parseColourVariantFilename(filename) : null,
    })),
  );

  for (const parsedRow of parsedRows) {
    const { filename, parsed, colourVariant, assignedImageSlot, tooManyVariantImages } = parsedRow;
    if (parsed.parseError || !parsed.code) {
      items.push({
        filename,
        code: '',
        title: '',
        price: 0,
        imageSlot: parsed.imageSlot || 1,
        warnings: ['invalid_filename'],
        parseError: parsed.parseError,
        websiteStatus: 'not_found',
        group: 'not_found',
      });
      groups.not_found += 1;
      continue;
    }

    if (tooManyVariantImages) {
      items.push({
        filename,
        code: colourVariant.variantSku,
        displayCode: colourVariant.variantSku,
        title: '',
        price: 0,
        imageSlot: null,
        positillCode: colourVariant.positillCode,
        variantCode: colourVariant.variantCode,
        variantLabel: colourVariant.variantLabel,
        variantOf: colourVariant.positillCode,
        isColourVariant: true,
        warnings: ['too_many_variant_images'],
        parseError: 'maximum_four_images_per_variant',
        websiteStatus: 'not_found',
        group: 'not_found',
        canPublish: false,
      });
      groups.not_found += 1;
      continue;
    }

    // Recognised colour suffixes are website variants, not Positill SKUs.
    // Resolve the base code first, then inspect the exact synthetic website SKU
    // so the colour keeps its own image gallery while inheriting ERP data.
    const lookupCode = colourVariant?.positillCode || parsed.code;
    const match = await resolveProductLoaderMatch(sb, {
      code: lookupCode,
      fullCode: colourVariant ? lookupCode : parsed.fullCode,
      displayCode: colourVariant ? lookupCode : parsed.displayCode,
      imageSlot: colourVariant ? assignedImageSlot : parsed.imageSlot,
      dormantSkus,
    });

    let item = { filename, ...match };

    if (colourVariant) {
      const variantWebsiteRow = await lookupWebsiteStockExact(sb, colourVariant.variantSku);
      const inheritedWebsiteRow = variantWebsiteRow || match.websiteRow;
      const imageSlot = assignedImageSlot || 1;
      const warnings = (match.warnings || [])
        .filter((warning) => ![
          'image_exists',
          'not_in_catalog',
          'price_zero',
          'low_stock',
          'needs_category',
        ].includes(warning));
      if (variantWebsiteRow?.[`image_url_${['one', 'two', 'three', 'four'][imageSlot - 1]}`]) {
        warnings.push('image_exists');
      }
      const hasSource = Boolean(match.sqlRow || inheritedWebsiteRow);
      if (!hasSource) warnings.push('not_in_catalog');
      const resolvedPrice = Number(match.sqlRow?.price ?? inheritedWebsiteRow?.price ?? match.price ?? 0);
      const resolvedAvailable = match.sqlRow?.available
        ?? inheritedWebsiteRow?.available_stock
        ?? inheritedWebsiteRow?.stock_qty
        ?? null;
      if (!resolvedPrice) warnings.push('price_zero');
      if (resolvedAvailable != null && Number(resolvedAvailable) <= 0) warnings.push('low_stock');
      if (!inheritedWebsiteRow?.category && !match.sqlRow) warnings.push('needs_category');
      const baseTitle = String(match.title || inheritedWebsiteRow?.title || '').trim();
      const variantTitle = baseTitle
        ? `${baseTitle.replace(/\s*\|\s*[^|]+$/, '')} | ${colourVariant.variantLabel}`
        : '';

      item = {
        ...item,
        code: colourVariant.variantSku,
        publishSku: colourVariant.variantSku,
        displayCode: colourVariant.variantSku,
        positillCode: colourVariant.positillCode,
        variantCode: colourVariant.variantCode,
        variantLabel: colourVariant.variantLabel,
        variantOf: colourVariant.positillCode,
        isVariant: true,
        isColourVariant: true,
        barcode: colourVariant.positillCode,
        title: variantTitle,
        price: resolvedPrice,
        stockOnHand: resolvedAvailable,
        imageSlot,
        websiteRow: inheritedWebsiteRow,
        variantWebsiteRow,
        baseWebsiteRow: match.websiteRow,
        websiteStatus: variantWebsiteRow ? 'live' : (match.sqlRow ? 'new' : match.websiteStatus),
        warnings,
        canPublish: hasSource,
        needsReview: warnings.some((warning) => (
          ['price_zero', 'image_exists', 'low_stock', 'needs_category'].includes(warning)
        )),
      };
    }

    // A "(2)/(3)" copy is the SAME product, another variant. It resolves the
    // PARENT (so it picks up the title/description/category/barcode) but
    // publishes to its own sibling record (CODE-2, CODE-3…) so it never
    // overwrites the parent's image.
    if (parsed.copyIndex > 1 && (match.websiteRow || match.sqlRow)) {
      const siblingSku = siblingSkuForCopy(match.code, parsed.copyIndex);
      const warnings = (match.warnings || []).filter((w) => w !== 'image_exists');
      item = {
        ...item,
        code: siblingSku,
        displayCode: siblingSku,
        isVariant: true,
        variantOf: match.code,
        copyIndex: parsed.copyIndex,
        imageSlot: 1,
        warnings,
        canPublish: true,
        needsReview: warnings.some((w) => ['price_zero', 'low_stock', 'needs_category'].includes(w)),
      };
    }

    if (item.canPublish) matched += 1;
    const group = classifyBatchItem(item);
    groups[group] += 1;

    items.push({ ...item, group });
  }

  const colourVariantSkus = new Set(items.filter((item) => item.isColourVariant).map((item) => item.code));
  const colourParentCodes = new Set(items.filter((item) => item.isColourVariant).map((item) => item.positillCode));
  return res.status(200).json({
    items,
    summary: {
      total: items.length,
      matched,
      ready: groups.ready,
      needsReview: groups.needs_review,
      notFound: groups.not_found,
      sqlConfigured: isSqlConfigured(),
      colourVariants: colourVariantSkus.size,
      colourParents: colourParentCodes.size,
    },
  });
}
