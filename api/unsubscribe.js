function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getEmail(req) {
  const source = req.method === 'POST' ? req.body : req.query;
  return String(source?.email || '').trim().toLowerCase();
}

function renderPage({ title, message }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="font-family:Arial,sans-serif;background:#f8fafc;color:#111827;margin:0;padding:32px;"><main style="max-width:560px;margin:10vh auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:28px;"><h1 style="font-size:24px;margin:0 0 12px;">${escapeHtml(title)}</h1><p style="font-size:16px;line-height:1.55;margin:0;">${escapeHtml(message)}</p></main></body></html>`;
}

async function markBrevoUnsubscribed(email) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY not configured');

  const resp = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
    method: 'PUT',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      emailBlacklisted: true,
    }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 404) return { missing: true };
    throw new Error(body.message || `Brevo ${resp.status}`);
  }
  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const email = getEmail(req);
  if (!email || !email.includes('@')) {
    const title = 'Unsubscribe';
    const message = 'Please use the unsubscribe link in your email, or reply with unsubscribe and we will remove you.';
    if (req.method === 'POST') return res.status(400).json({ error: message });
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.status(400).send(renderPage({ title, message }));
  }

  try {
    const result = await markBrevoUnsubscribed(email);
    const message = result.missing
      ? 'This email address was not found on our marketing list, so there is nothing more to do.'
      : 'You have been unsubscribed from Proto marketing emails.';
    if (req.method === 'POST') return res.status(200).json({ ok: true, email, missing: !!result.missing });
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.status(200).send(renderPage({ title: 'Unsubscribed', message }));
  } catch (err) {
    console.error('unsubscribe:', err?.message || err);
    const message = 'We could not unsubscribe you automatically. Please reply to the email with unsubscribe and we will remove you.';
    if (req.method === 'POST') return res.status(500).json({ error: message });
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.status(500).send(renderPage({ title: 'Unsubscribe failed', message }));
  }
}
