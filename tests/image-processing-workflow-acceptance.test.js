import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const centreSource = fs.readFileSync(new URL('../src/components/productLoader/ImageProcessingCentre.jsx', import.meta.url), 'utf8');
const jobsAdapterSource = fs.readFileSync(new URL('../src/lib/imageProcessingJobs.js', import.meta.url), 'utf8');
const jobsRouteSource = fs.readFileSync(new URL('../api/image-processing-jobs.js', import.meta.url), 'utf8');
const serviceSource = fs.readFileSync(new URL('../api/_image-processing-service.js', import.meta.url), 'utf8');

function sourceSection(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, `Could not find ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `Could not find ${end}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('Image Processing Centre owner-safety acceptance contract', () => {
  it('keeps a newly queued local upload visible when an earlier queue load returns late', () => {
    const loadJobs = sourceSection(centreSource, 'const loadJobs = useCallback', 'useEffect(() => { void loadJobs();');
    const queueUploads = sourceSection(centreSource, 'const queueUploads = async', 'const runAction = async');

    expect(loadJobs).toContain('const loadSequence = ++queueLoadSequenceRef.current');
    expect(loadJobs).toContain('const mutationVersion = queueMutationVersionRef.current');
    expect(loadJobs).toContain('loadSequence !== queueLoadSequenceRef.current');
    expect(loadJobs).toContain('mutationVersion !== queueMutationVersionRef.current');
    expect(loadJobs).toContain('setJobs(rows)');
    expect(queueUploads).toContain('markQueueMutation();');
    expect(queueUploads).toContain('mergeJobs(created);');
  });

  it('records manual approval without publishing or changing Product Manager', () => {
    const approvalBranch = sourceSection(jobsRouteSource, "} else if (action === 'approve')", "} else if (action === 'publish')");
    const approvalService = sourceSection(serviceSource, 'export function markImageApproved', 'export async function publishApprovedImage');
    const reviewControls = sourceSection(centreSource, "runAction(selectedJob, 'approve')", "runAction(selectedJob, 'reject')");

    expect(approvalBranch).toContain('markImageApproved');
    expect(approvalBranch).not.toContain('publishApprovedImage');
    expect(approvalService).toContain("status: 'approved'");
    expect(approvalService).not.toContain('publishedUrl');
    expect(approvalService).not.toContain('publication:');
    expect(reviewControls).toContain('Approve result');
  });

  it('requires an exact Product Manager SKU before an approved result can be sent', () => {
    const destinationLookup = sourceSection(centreSource, 'useEffect(() => {\n    const sku = normalizedSku(selectedJob?.destination?.sku || selectedJob?.sku);', 'const mergeJobs = useCallback');
    const publishControl = sourceSection(centreSource, 'const requestProductManagerSend =', 'const clearJob = async');

    expect(destinationLookup).toContain('/api/product-loader-lookup?code=${encodeURIComponent(sku)}');
    expect(destinationLookup).toContain('normalizedSku(product.sku) !== sku');
    expect(destinationLookup).toContain('No exact Product Manager product matches SKU');
    expect(publishControl).toContain('if (!destinationProduct) return;');
    expect(publishControl).toContain('if (!destinationProduct) return;');
    expect(publishControl).toContain("runAction(job, 'publish'");
    expect(centreSource).toContain('Review replacement');
    expect(centreSource).toContain('Confirm and Send to Product Manager');
  });

  it('lets an owner deliberately bind an unmatched filename to a verified Product Manager product before sending', () => {
    expect(centreSource).toContain('Find Product Manager product');
    expect(centreSource).toContain('Use this exact Product Manager product');
    expect(centreSource).toContain("runAction(job, 'assign_destination'");
    expect(jobsRouteSource).toContain("action === 'assign_destination'");
    expect(serviceSource).toContain('export async function assignImageDestination');
    expect(serviceSource).toContain("source: 'manual_selection'");
    expect(serviceSource).toContain("if (!['review', 'approved'].includes(image.status))");
  });

  it('allows rejected and failed work to be cleared only through the explicit safe queue action', () => {
    const clearService = sourceSection(serviceSource, 'export async function clearUnpublishedImage', 'async function objectExists');
    const clearUi = sourceSection(centreSource, 'const clearJob = async', 'useEffect(() => {\n    if (busy || processInFlightRef.current)');

    expect(centreSource).toContain("const CLEARABLE_STATUSES = new Set(['review', 'ready', 'completed', 'failed', 'error', 'rejected'])");
    expect(centreSource).toContain("['failed', 'error', 'rejected'].includes(selectedJob.status)");
    expect(clearUi).toContain('It does not change any product or Nutstore image.');
    expect(clearUi).toContain('await clearImageProcessingJob(job.id);');
    expect(jobsAdapterSource).toContain("body: JSON.stringify({ action: 'clear' })");
    expect(serviceSource).toContain("const CLEARABLE_IMAGE_STATUSES = new Set(['review', 'ready', 'completed', 'failed', 'error', 'rejected'])");
    expect(clearService).toContain('Approved or published images cannot be cleared from this queue');
  });

  it('keeps restore as a separate action, available only after an explicit Product Manager send', () => {
    const restoreService = sourceSection(serviceSource, 'export async function restorePublishedOriginal', '\n}');

    expect(centreSource).toContain("selectedJob.status === 'published' && <div className=\"ipc-published-actions\"");
    expect(centreSource).toContain("runAction(selectedJob, 'restore')");
    expect(restoreService).toContain("image.status !== 'published'");
    expect(restoreService).toContain('Only a published processed image can be restored');
    expect(restoreService).toContain("publishMode: 'restore_original'");
  });
});
