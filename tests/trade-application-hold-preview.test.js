import { describe, expect, it } from 'vitest';
import { addHoldPreview, HOLD_PREVIEW_ID, holdPreviewEnabled } from '../src/lib/tradeApplicationHoldPreview.js';

describe('trade application hold preview', () => {
  it('requires the explicit preview query parameter', () => {
    expect(holdPreviewEnabled('?previewHoldApplication=1')).toBe(true);
    expect(holdPreviewEnabled('?previewHoldApplication=0')).toBe(false);
  });

  it('moves the sample between the matching preview queues', () => {
    expect(addHoldPreview([], { enabled: true, tab: 'requests', status: 'pending' })[0].id).toBe(HOLD_PREVIEW_ID);
    expect(addHoldPreview([], { enabled: true, tab: 'on-hold', status: 'pending' })).toEqual([]);

    const held = addHoldPreview([], {
      enabled: true,
      tab: 'on-hold',
      status: 'on_hold',
      reason: 'Waiting for documents.',
    });
    expect(held[0].application_status).toBe('on_hold');
    expect(held[0].application_hold_reason).toBe('Waiting for documents.');
  });
});
