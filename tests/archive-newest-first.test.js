import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  excelImageArchiveSource,
  isExcelImageArchiveSource,
  prioritizeLatestExcelImageBatch,
  prioritizeRowsBySku,
} from '../lib/archive-priority.mjs';

const ROOT = resolve(import.meta.dirname, '..');

describe('Archive ordering', () => {
  it('defaults Archive to the true archive time without changing other catalogue defaults', () => {
    const api = readFileSync(resolve(ROOT, 'api/catalog.js'), 'utf8');
    const screen = readFileSync(resolve(ROOT, 'src/components/ProductManagerEngine.jsx'), 'utf8');
    expect(api).toContain("status === 'archived' ? 'archived' : 'title'");
    expect(api).toContain(".order('archived_at', { ascending: false, nullsFirst: false })");
    expect(api).toContain(".order('updated_at', { ascending: false, nullsFirst: false })");
    expect(screen).toContain('most recently archived items appear next');
  });

  it('refreshes Archive immediately after an Excel/image intake', () => {
    const importer = readFileSync(resolve(ROOT, 'src/components/productLoader/ProductLoaderVariantImport.jsx'), 'utf8');
    expect(importer).toContain("query.queryKey[1]?.status === 'archived'");
    expect(importer).toContain('await refreshArchive()');
  });

  it('does not show a stale cached Archive page on first open', () => {
    const hook = readFileSync(resolve(ROOT, 'src/hooks/useCatalog.js'), 'utf8');
    expect(hook).toContain("const isArchive = params.status === 'archived'");
    expect(hook).toContain('placeholderData: isArchive ? undefined : keepPreviousData');
    expect(hook).toContain("refetchOnMount: isArchive ? 'always' : true");
  });

  it('pins the current Excel batch without changing stored archive data', () => {
    const rows = [{ sku: 'KKC4' }, { sku: 'MUG519-GRY' }, { sku: 'MUG514-BLK' }];
    const ordered = prioritizeRowsBySku(rows, ['MUG514-BLK', 'MUG519-GRY']);
    expect(ordered.map((row) => row.sku)).toEqual(['MUG514-BLK', 'MUG519-GRY', 'KKC4']);
    expect(rows.map((row) => row.sku)).toEqual(['KKC4', 'MUG519-GRY', 'MUG514-BLK']);
  });

  it('shares the temporary Excel batch between preview tabs', () => {
    const priority = readFileSync(resolve(ROOT, 'lib/archive-priority.mjs'), 'utf8');
    const screen = readFileSync(resolve(ROOT, 'src/components/ProductManagerEngine.jsx'), 'utf8');
    expect(priority).toContain('localStorage.setItem');
    expect(priority).not.toContain('sessionStorage.setItem');
    expect(priority).toContain('ARCHIVE_PRIORITY_TTL_MS');
    expect(screen).toContain("window.addEventListener('storage'");
    expect(screen).toContain('ARCHIVE_PRIORITY_STORAGE_KEY');
  });

  it('records a safe server-side Excel batch marker without a schema change', () => {
    expect(excelImageArchiveSource('batch_20260815-abc')).toBe('excel-images:batch_20260815-abc');
    expect(excelImageArchiveSource('bad:batch')).toBe('excel-images');
    expect(isExcelImageArchiveSource('excel-images:batch_20260815-abc')).toBe(true);
    expect(isExcelImageArchiveSource('nutstore')).toBe(false);

    const endpoint = readFileSync(resolve(ROOT, 'api/product-loader-variant-archive.js'), 'utf8');
    expect(endpoint).toContain('excelImageArchiveSource(body.batchId)');
    expect(endpoint).toContain('archived_by: archivedBy');
  });

  it('can include a partial retry without overwriting existing product fields', () => {
    const endpoint = readFileSync(resolve(ROOT, 'api/product-loader-variant-archive.js'), 'utf8');
    expect(endpoint).toContain('includeExistingInBatch');
    expect(endpoint).toContain(".update({ archived_by: archivedBy, archived_at: now })");
    expect(endpoint).toContain("action: 'included'");
    expect(endpoint).not.toContain('.upsert(payload)');
  });

  it('pins the newest server-recorded Excel batch before pagination in every tab', () => {
    const rows = [
      { sku: 'MUG515-BOW', archived_by: 'excel-images:batch-new' },
      { sku: 'KKC4', archived_by: 'product-manager' },
      { sku: 'MUG514-BLK', archived_by: 'excel-images:batch-old' },
      { sku: 'MUG519-GRY', archived_by: 'excel-images:batch-new' },
    ];
    const ordered = prioritizeLatestExcelImageBatch(rows);
    expect(ordered.map((row) => row.sku)).toEqual(['MUG515-BOW', 'MUG519-GRY', 'KKC4', 'MUG514-BLK']);
    expect(rows.map((row) => row.sku)).toEqual(['MUG515-BOW', 'KKC4', 'MUG514-BLK', 'MUG519-GRY']);

    const api = readFileSync(resolve(ROOT, 'api/catalog.js'), 'utf8');
    expect(api).toContain('? prioritizeLatestExcelImageBatch(rows)');
    expect(api).toContain('pinnedBatchCount');
    const prioritizeAt = api.indexOf('? prioritizeLatestExcelImageBatch(rows)');
    expect(prioritizeAt).toBeGreaterThan(-1);
    expect(api.indexOf('paginateRows(rows, page, pageSize)', prioritizeAt)).toBeGreaterThan(prioritizeAt);
  });
});
