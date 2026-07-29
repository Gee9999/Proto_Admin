import { describe, expect, it } from 'vitest';
import { classifyWatiHealth } from '../api/whatsapp-health.js';

describe('WhatsApp health status', () => {
  it('reports a missing token without exposing configuration values', () => {
    expect(classifyWatiHealth({ configured: false })).toEqual({
      status: 'missing_token',
      configured: false,
      connected: false,
      message: 'WhatsApp token is not configured',
    });
  });

  it('only calls WATI connected after a successful authenticated response', () => {
    expect(classifyWatiHealth({ configured: true, responseStatus: 200 }))
      .toEqual(expect.objectContaining({ status: 'connected', connected: true }));
    expect(classifyWatiHealth({ configured: true, responseStatus: 401 }))
      .toEqual(expect.objectContaining({ status: 'configuration_error', connected: false }));
    expect(classifyWatiHealth({ configured: true, responseStatus: 404 }))
      .toEqual(expect.objectContaining({ status: 'configuration_error', connected: false }));
  });

  it('distinguishes service failures from authentication and configuration errors', () => {
    expect(classifyWatiHealth({ configured: true, responseStatus: 503 }))
      .toEqual(expect.objectContaining({ status: 'service_unreachable', connected: false }));
    expect(classifyWatiHealth({ configured: true, networkError: true }))
      .toEqual(expect.objectContaining({ status: 'service_unreachable', connected: false }));
  });

  it('never includes a token or WATI account URL in its response shape', () => {
    const result = classifyWatiHealth({ configured: true, responseStatus: 200 });
    expect(result).not.toHaveProperty('token');
    expect(result).not.toHaveProperty('baseUrl');
  });
});
