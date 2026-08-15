import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchVariantImages, variantRowState } from '../src/lib/productVariantImport.js';

const ROOT = resolve(import.meta.dirname, '..');
const image = (name) => ({ name, type: 'image/jpeg' });

describe('Excel + local image variant import', () => {
  it('keeps different SKUs and titles separate when they share one barcode', () => {
    const rows = [
      { sku: 'MUG514-BLK', barcode: '8626000514', title: 'Black mug' },
      { sku: 'MUG514-WHT', barcode: '8626000514', title: 'White mug' },
    ];
    const result = matchVariantImages(rows, [
      image('MUG514-BLK.jpg'), image('MUG514-BLK.2.jpg'), image('MUG514-WHT.jpg'),
    ]);
    expect(result.items[0]).toMatchObject({ sku: 'MUG514-BLK', title: 'Black mug', hasPrimaryImage: true });
    expect(result.items[0].images.map((entry) => entry.slot)).toEqual([1, 2]);
    expect(result.items[1]).toMatchObject({ sku: 'MUG514-WHT', title: 'White mug', hasPrimaryImage: true });
    expect(result.items[1].images.map((entry) => entry.slot)).toEqual([1]);
  });

  it('never fuzzy-matches an unrelated filename', () => {
    const result = matchVariantImages(
      [{ sku: 'MUG514-BLK', barcode: '8626000514', title: 'Black mug' }],
      [image('MUG514.jpg'), image('MUG514-BLACK.jpg')],
    );
    expect(result.items[0].images).toHaveLength(0);
    expect(result.unmatched).toHaveLength(2);
  });

  it('blocks existing SKUs, duplicate slots and rows without a main image', () => {
    expect(variantRowState({ existing: true }).ready).toBe(false);
    expect(variantRowState({ sourceFound: true, price: 10, hasPrimaryImage: false }).ready).toBe(false);
    expect(variantRowState({ sourceFound: true, price: 10, hasPrimaryImage: true, duplicateSlots: [{ slot: 1 }] }).ready).toBe(false);
    expect(variantRowState({ sourceFound: true, price: 10, hasPrimaryImage: true, duplicateSlots: [] })).toEqual({ ready: true, reason: 'Ready' });
  });

  it('protects existing website and Archive SKUs before storage upload', () => {
    const client = readFileSync(resolve(ROOT, 'src/lib/productLoaderApi.js'), 'utf8');
    const endpoint = readFileSync(resolve(ROOT, 'api/upload-product-image.js'), 'utf8');
    expect(client).toContain('requireNew = false');
    expect(endpoint).toContain(".from('website_stock')");
    expect(endpoint).toContain(".from('archived_products')");
    expect(endpoint).toContain("code: 'exists'");
    expect(endpoint).toContain('upsert: Boolean(safeSku) && !requireNew');
  });

  it('stages the batch in Archive with category selection removed from intake', () => {
    const component = readFileSync(resolve(ROOT, 'src/components/productLoader/ProductLoaderVariantImport.jsx'), 'utf8');
    const archiveEndpoint = readFileSync(resolve(ROOT, 'api/product-loader-variant-archive.js'), 'utf8');
    const catalogueEndpoint = readFileSync(resolve(ROOT, 'api/catalog.js'), 'utf8');
    expect(component).toContain('Send {readyRows.length} to Archive');
    expect(component).not.toContain('CategoryPathSelect');
    expect(component).not.toContain('Create {readyRows.length} new products');
    expect(archiveEndpoint).toContain("const ARCHIVED_BY = 'excel-images'");
    expect(archiveEndpoint).toContain("category: 'Uncategorised'");
    expect(archiveEndpoint).toContain("subcategory_one: 'General'");
    expect(catalogueEndpoint).toContain("r.archived_by === 'excel-images'");
  });
});
