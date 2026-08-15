import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

describe('Archive ordering', () => {
  it('defaults Archive to newest updated first without changing other catalogue defaults', () => {
    const api = readFileSync(resolve(ROOT, 'api/catalog.js'), 'utf8');
    const screen = readFileSync(resolve(ROOT, 'src/components/ProductManagerEngine.jsx'), 'utf8');
    expect(api).toContain("status === 'archived' ? 'updated' : 'title'");
    expect(api).toContain("q.order('updated_at', { ascending: false })");
    expect(screen).toContain('Newest archived items appear first');
  });
});
