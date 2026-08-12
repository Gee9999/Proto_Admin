import { describe, expect, it } from 'vitest';
import {
  addTradeRequestPreview,
  TRADE_REQUEST_PREVIEW_ID,
  tradeRequestPreviewEnabled,
} from '../src/lib/tradeRequestPreview.js';

describe('trade request preview fixture', () => {
  it('only activates through the explicit preview query parameter', () => {
    expect(tradeRequestPreviewEnabled('?previewTradeRequest=1')).toBe(true);
    expect(tradeRequestPreviewEnabled('?previewTradeRequest=0')).toBe(false);
    expect(tradeRequestPreviewEnabled('')).toBe(false);
  });

  it('adds one safe sample request until its simulated approval', () => {
    const realRequest = { id: 'real-request' };
    const rows = addTradeRequestPreview([realRequest], { enabled: true });

    expect(rows.map((row) => row.id)).toEqual([TRADE_REQUEST_PREVIEW_ID, 'real-request']);
    expect(rows[0].__previewOnly).toBe(true);
    expect(addTradeRequestPreview(rows, { enabled: true })).toBe(rows);
    expect(addTradeRequestPreview([realRequest], { enabled: true, approved: true })).toEqual([realRequest]);
  });
});
