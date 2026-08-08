import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const panel = readFileSync(new URL('../src/components/ProductLoaderPanel.jsx', import.meta.url), 'utf8');
const queue = readFileSync(new URL('../src/components/productLoader/ProductLoaderDormantQueue.jsx', import.meta.url), 'utf8');
const processor = readFileSync(new URL('../api/image-processing-preview.js', import.meta.url), 'utf8');

describe('Image Processing Centre review flow', () => {
  it('uses exact Nutstore image-processing lookup before queueing', () => {
    expect(panel).toContain("purpose: 'image_processing'");
    expect(panel).toContain('if (!item?.canQueue) return;');
    expect(queue).toContain('Only an exact existing SKU and image slot can be queued.');
  });

  it('shows a safe manual lifecycle and gates approval on a visible result', () => {
    expect(queue).toContain('Queued → Processing → Ready for review → Approved');
    expect(queue).toContain("selectedJob.status !== 'ready_for_review' || !selectedJob.processedUrl");
    expect(queue).toContain('Original from Nutstore');
    expect(queue).toContain('Processed preview');
    expect(queue).toContain('Processing history');
  });

  it('uses the preview processor with authenticated Nutstore source and no live publish control', () => {
    expect(panel).toContain("fetch('/api/image-processing-preview'");
    expect(panel).toContain('nutstorePath: job.nutstorePath');
    expect(queue).not.toContain('>Publish<');
    expect(processor).toContain('downloadNutstoreFile(input.nutstorePath)');
    expect(processor).toContain('previewOnly: true');
  });
});
