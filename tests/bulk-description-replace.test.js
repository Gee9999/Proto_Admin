import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDescriptionRows } from '../src/lib/bulkDescriptionReplace.js';
import { resolvePreviewRows } from '../api/bulk-description-replace.js';

describe('bulk title replacement spreadsheet', () => {
  it('keeps separate descriptions for SKUs that share a barcode', () => {
    const rows = parseDescriptionRows([
      ['SKU', 'IMAGE NAME', 'BARCODE', 'DESCRIPTION'],
      ['MUG514-BLK', 'MUG514-BLK,MUG514-BLK1', '8626000514', 'BLACK MUG'],
      ['MUG514-WHT', 'MUG514-WHT,MUG514-WHT1', '8626000514', 'WHITE MUG'],
      ['MUG514-BLU', 'MUG514-BLU,MUG514-BLU1', '8626000514', 'BLUE MUG'],
    ]);

    expect(rows).toEqual([
      { sku: 'MUG514-BLK', barcode: '8626000514', title: 'BLACK MUG' },
      { sku: 'MUG514-WHT', barcode: '8626000514', title: 'WHITE MUG' },
      { sku: 'MUG514-BLU', barcode: '8626000514', title: 'BLUE MUG' },
    ]);
  });

  it('uses a shared barcode to find the group and exact SKU to select each item', () => {
    const rows = resolvePreviewRows([
      { sku: 'MUG514-BLK', barcode: '8626000514' },
      { sku: 'MUG514-WHT', barcode: '8626000514' },
      { sku: 'MUG514-BLU', barcode: '8626000514' },
    ], [
      { sku: 'MUG514-BLK', barcode: '8626000514', title: 'Old black' },
      { sku: 'MUG514-WHT', barcode: '8626000514', title: 'Old white' },
      { sku: 'MUG514-BLU', barcode: '8626000514', title: 'Old blue' },
    ]);

    expect(rows).toEqual([
      expect.objectContaining({ sku: 'MUG514-BLK', barcode: '8626000514', found: true, matchedBy: 'barcode_and_sku' }),
      expect.objectContaining({ sku: 'MUG514-WHT', barcode: '8626000514', found: true, matchedBy: 'barcode_and_sku' }),
      expect.objectContaining({ sku: 'MUG514-BLU', barcode: '8626000514', found: true, matchedBy: 'barcode_and_sku' }),
    ]);
  });

  it('does not guess when the barcode group has no matching SKU', () => {
    const [row] = resolvePreviewRows(
      [{ sku: 'MUG514-RED', barcode: '8626000514' }],
      [{ sku: 'MUG514-BLK', barcode: '8626000514', title: 'Black' }],
    );

    expect(row).toEqual(expect.objectContaining({
      sku: 'MUG514-RED',
      barcode: '8626000514',
      found: false,
      reason: 'not_found',
    }));
  });

  it('blocks an ambiguous duplicate instead of updating both records', () => {
    const [row] = resolvePreviewRows(
      [{ sku: 'MUG514-BLK', barcode: '8626000514' }],
      [
        { sku: 'MUG514-BLK', barcode: '8626000514', title: 'First' },
        { sku: 'mug514-blk', barcode: '8626000514', title: 'Duplicate' },
      ],
    );

    expect(row).toEqual(expect.objectContaining({
      found: false,
      ambiguous: true,
      reason: 'ambiguous_barcode_and_sku',
    }));
  });

  it('normalizes SKU case and lets only a repeated exact SKU correct itself', () => {
    const rows = parseDescriptionRows([
      ['Website SKU', 'Title'],
      [' mug514-blk ', 'Old black title'],
      ['MUG514-WHT', 'White title'],
      ['MUG514-BLK', 'Corrected black title'],
    ]);

    expect(rows).toEqual([
      { sku: 'MUG514-BLK', barcode: '', title: 'Corrected black title' },
      { sku: 'MUG514-WHT', barcode: '', title: 'White title' },
    ]);
  });

  it('rejects a barcode-only sheet instead of risking a multi-SKU overwrite', () => {
    expect(() => parseDescriptionRows([
      ['BARCODE', 'DESCRIPTION'],
      ['8626000514', 'Unsafe shared title'],
    ])).toThrow(/SKU and TITLE columns/);
  });

  it('updates only by SKU and never overwrites barcode or images', () => {
    const api = readFileSync(new URL('../api/bulk-description-replace.js', import.meta.url), 'utf8');

    expect(api).toContain(".in('sku', chunk)");
    expect(api).toContain(".in('barcode', chunk)");
    expect(api).toContain(".eq('sku', sku)");
    expect(api).not.toMatch(/\.update\(\{[^}]*barcode/s);
    expect(api).not.toMatch(/\.update\(\{[^}]*image_url/s);
  });
});
