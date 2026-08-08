import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const panel = readFileSync(new URL('../src/components/ProductLoaderPanel.jsx', import.meta.url), 'utf8');
const upload = readFileSync(new URL('../src/components/productLoader/ProductLoaderUpload.jsx', import.meta.url), 'utf8');
const processor = readFileSync(new URL('../api/image-processing-preview.js', import.meta.url), 'utf8');

describe('Generic Upload handoff to Image Processing Centre', () => {
  it('retains uploads and offers a visible, exact-match-only handoff', () => {
    expect(upload).toContain('Your selected uploads stay here until you choose what to do with them.');
    expect(upload).toContain('Send to Centre');
    expect(upload).toContain('Needs exact existing SKU');
    expect(panel).toContain('sendUploadedImageToCentre');
    expect(panel).toContain("setActiveTab('image-centre')");
  });

  it('sends the retained local file to the preview processor without a live write', () => {
    expect(panel).toContain('sourceBase64: job.sourceBase64');
    expect(processor).toContain('sourceImageUrl, nutstorePath or sourceBase64 is required');
    expect(processor).toContain("status: 'review'");
    expect(processor).not.toContain(".from('website_stock')");
  });
});
