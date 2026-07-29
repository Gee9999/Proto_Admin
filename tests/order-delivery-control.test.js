import { describe, expect, it } from 'vitest';
import {
  appendAudit,
  isOrderNotifyComplete,
  orderItems,
} from '../api/_order-notify-core.js';

describe('order delivery control centre', () => {
  it('keeps all 250 product lines available for an internal resend', () => {
    const lines = Array.from({ length: 250 }, (_, index) => ({
      code: `SKU-${index + 1}`,
      qty: 1,
    }));
    expect(orderItems({ original_items: lines, items: [] })).toHaveLength(250);
    expect(orderItems({ original_items: lines })[249].code).toBe('SKU-250');
  });

  it('requires the operational email before notification is complete', () => {
    expect(isOrderNotifyComplete({
      found: true,
      emailSent: false,
      sent: 2,
      failed: 0,
      teamSize: 2,
    })).toEqual(expect.objectContaining({ ok: false }));
  });

  it('retains a bounded delivery audit with the newest 25 events', () => {
    const deliveryHistory = Array.from({ length: 25 }, (_, index) => ({ at: String(index) }));
    const next = appendAudit({ deliveryHistory }, { at: 'newest', ok: true });
    expect(next).toHaveLength(25);
    expect(next[0].at).toBe('1');
    expect(next[24].at).toBe('newest');
  });
});
