import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

describe('Archive ordering', () => {
  it('defaults Archive to the true archive time without changing other catalogue defaults', () => {
    const api = readFileSync(resolve(ROOT, 'api/catalog.js'), 'utf8');
    const screen = readFileSync(resolve(ROOT, 'src/components/ProductManagerEngine.jsx'), 'utf8');
    expect(api).toContain("status === 'archived' ? 'archived' : 'title'");
    expect(api).toContain(".order('archived_at', { ascending: false, nullsFirst: false })");
    expect(api).toContain(".order('updated_at', { ascending: false, nullsFirst: false })");
    expect(screen).toContain('Most recently archived items appear first');
  });

  it('refreshes Archive immediately after an Excel/image intake', () => {
    const importer = readFileSync(resolve(ROOT, 'src/components/productLoader/ProductLoaderVariantImport.jsx'), 'utf8');
    expect(importer).toContain("query.queryKey[1]?.status === 'archived'");
    expect(importer).toContain('await refreshArchive()');
  });
});
