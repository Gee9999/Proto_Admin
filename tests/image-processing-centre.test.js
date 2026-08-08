import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const panel = readFileSync(new URL('../src/components/ProductLoaderPanel.jsx', import.meta.url), 'utf8');
const queue = readFileSync(new URL('../src/components/productLoader/ProductLoaderDormantQueue.jsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/product-loader-dormant.js', import.meta.url), 'utf8');
const vercel = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');

describe('Image Processing Centre preview', () => {
  it('mounts the intended queue surface in the product loader', () => {
    expect(panel).toContain("ProductLoaderDormantQueue");
    expect(panel).toContain("id: 'image-centre', label: 'Image Processing Centre'");
    expect(panel).toContain("activeTab === 'image-centre' && !dormantRequested && !dormantLoading");
    expect(panel).toContain("event.detail === 'product-loader' && (activeTab === 'image-centre' || dormantRequested)");
  });

  it('shows retryable loading and empty states in the queue panel', () => {
    expect(queue).toContain('Retry queue load');
    expect(queue).toContain('No products are waiting in Image Processing Centre.');
    expect(queue).toContain('Loading queue...');
    expect(queue).toContain('Preview-only image review. Originals stay intact; this screen cannot publish to live products.');
  });

  it('only checks live status for the queue rows instead of scanning the full website catalogue', () => {
    expect(api).toMatch(/from\('website_stock'\)\s*\.select\('sku'\)\s*\.in\('sku', chunk\)/);
    expect(api).not.toContain("from('website_stock').select('sku').range(from, from + PAGE_SIZE - 1)");
    expect(vercel).toContain('"api/product-loader-dormant.js": {');
    expect(vercel).toContain('"maxDuration": 60');
  });
});
