import { requireAdminKey } from './_admin-auth.js';
import { watiConfig } from './_wati-notify.js';

const PROBE_TIMEOUT_MS = 7000;

export function classifyWatiHealth({ configured, responseStatus, networkError = false }) {
  if (!configured) {
    return {
      status: 'missing_token',
      configured: false,
      connected: false,
      message: 'WhatsApp token is not configured',
    };
  }

  if (networkError || !Number.isInteger(responseStatus) || responseStatus >= 500) {
    return {
      status: 'service_unreachable',
      configured: true,
      connected: false,
      message: 'WATI service is unreachable',
    };
  }

  if (responseStatus >= 200 && responseStatus < 300) {
    return {
      status: 'connected',
      configured: true,
      connected: true,
      message: 'WhatsApp connected',
    };
  }

  return {
    status: 'configuration_error',
    configured: true,
    connected: false,
    message: responseStatus === 401 || responseStatus === 403
      ? 'WhatsApp authentication failed'
      : 'WhatsApp configuration needs attention',
  };
}

export default async function handler(req, res) {
  if (!(await requireAdminKey(req, res))) return;
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).end();

  const { baseUrl, token } = watiConfig();
  if (!token) {
    return res.status(200).json({
      ...classifyWatiHealth({ configured: false }),
      checkedAt: new Date().toISOString(),
    });
  }

  try {
    const response = await fetch(`${baseUrl}/api/v1/getContacts?pageSize=1&pageNumber=1`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    return res.status(200).json({
      ...classifyWatiHealth({ configured: true, responseStatus: response.status }),
      checkedAt: new Date().toISOString(),
    });
  } catch {
    return res.status(200).json({
      ...classifyWatiHealth({ configured: true, networkError: true }),
      checkedAt: new Date().toISOString(),
    });
  }
}
