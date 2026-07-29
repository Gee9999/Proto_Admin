import { describe, expect, it } from 'vitest';
import {
  assignColourVariantImageSlots,
  parseColourVariantFilename,
} from '../lib/product-colour-variants.mjs';
import {
  customerPriceFromPositill,
  resolveLoaderCustomerPrice,
} from '../lib/catalogue-price.mjs';

describe('Product Loader colour variants', () => {
  it('splits a recognised suffix from the Positill base code', () => {
    expect(parseColourVariantFilename('8621000002-WHT.jpg')).toMatchObject({
      positillCode: '8621000002',
      variantCode: 'WHT',
      variantLabel: 'White',
      variantSku: '8621000002-WHT',
    });
  });

  it('repairs spaces around the separator and maps Camel', () => {
    expect(parseColourVariantFilename('8621000002- CAM.2.jpg')).toMatchObject({
      positillCode: '8621000002',
      variantCode: 'CAM',
      variantLabel: 'Camel',
      preferredSlot: 2,
    });
  });

  it('does not reinterpret a real dashed Positill code as a colour', () => {
    expect(parseColourVariantFilename('MP198-1.jpg')).toBeNull();
  });

  it('keeps a dashed Positill code and reads only the final colour suffix', () => {
    expect(parseColourVariantFilename('MP198-1-WHT.jpg')).toMatchObject({
      positillCode: 'MP198-1',
      variantCode: 'WHT',
      variantSku: 'MP198-1-WHT',
    });
  });

  it('allocates independent 1-4 galleries for each colour', () => {
    const rows = [
      '8621000002-WHT.jpg',
      '8621000002-CRM.jpg',
      '8621000002-CRM.2.jpg',
      '8621000002-WHT.2.jpg',
      '8621000002-CAM.2.jpg',
      '8621000002-CAM.jpg',
    ].map((filename) => ({
      filename,
      colourVariant: parseColourVariantFilename(filename),
    }));

    const assigned = assignColourVariantImageSlots(rows);
    expect(assigned.map((row) => [row.colourVariant.variantSku, row.assignedImageSlot])).toEqual([
      ['8621000002-WHT', 1],
      ['8621000002-CRM', 1],
      ['8621000002-CRM', 2],
      ['8621000002-WHT', 2],
      ['8621000002-CAM', 2],
      ['8621000002-CAM', 1],
    ]);
  });

  it('blocks the fifth image instead of overwriting an existing slot', () => {
    const rows = [1, 2, 3, 4, 5].map((copyIndex) => ({
      filename: `8621000002-WHT (${copyIndex}).jpg`,
      colourVariant: {
        ...parseColourVariantFilename('8621000002-WHT.jpg'),
        copyIndex,
      },
    }));
    const assigned = assignColourVariantImageSlots(rows);
    expect(assigned.filter((row) => row.tooManyVariantImages)).toHaveLength(1);
  });

  it('converts raw Positill PRICE_A to the customer VAT-inclusive half-rand price', () => {
    expect(customerPriceFromPositill(43.04)).toBe(49.5);
  });

  it('uses the synchronised customer price before raw ERP or website values', () => {
    expect(resolveLoaderCustomerPrice({
      productSellPrice: 49.5,
      websitePrice: 43.04,
      positillPriceExVat: 43.04,
    })).toEqual({
      price: 49.5,
      source: 'products.sell_price',
    });
  });

  it('falls back to VAT conversion when no customer price exists yet', () => {
    expect(resolveLoaderCustomerPrice({
      positillPriceExVat: 43.04,
    })).toEqual({
      price: 49.5,
      source: 'positill.price_a_vat_rounded',
    });
  });
});
