import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const upload = readFileSync(new URL('../src/components/productLoader/ProductLoaderUpload.jsx', import.meta.url), 'utf8');
const draft = readFileSync(new URL('../src/lib/productLoaderUploadDraft.js', import.meta.url), 'utf8');

describe('Product Loader upload draft retention', () => {
  it('keeps selected files in a local draft across Upload tab remounts', () => {
    expect(upload).toContain('getProductLoaderUploadDraft');
    expect(upload).toContain('saveProductLoaderUploadDraft(items)');
    expect(draft).toContain('memoryDraft = items');
  });

  it('shows recovery and a deliberate discard state without publishing', () => {
    expect(upload).toContain('Upload draft saved in this browser');
    expect(upload).toContain('it was never published');
    expect(upload).toContain('Discard draft');
  });
});
