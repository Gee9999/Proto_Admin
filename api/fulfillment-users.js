import { requireAdminOrOrderToken, requireOwner } from './_admin-auth.js';
import { readSiteConfigJson, writeSiteConfigJson } from './_site-config.js';
import { defaultFulfillmentUsers } from './_fulfillment-defaults.js';
import { normalizePhone } from './_phone.js';

const USERS_FILE = 'fulfillment/users.json';

/** Store numbers as +<countrycode><number>. */
function toContactPhone(raw) {
  const digits = normalizePhone(raw);
  return digits ? `+${digits}` : '';
}

function normalizeUsers(payload) {
  const users = (payload?.users || []).map((u, i) => ({
    id: String(u.id || `user-${i + 1}`).trim(),
    name: String(u.name || '').trim(),
    whatsapp: toContactPhone(u.whatsapp),
    // Backward compatible: team members saved before this switch existed
    // continue receiving order alerts until an owner explicitly disables them.
    isAdmin: Boolean(u.isAdmin),
    categoryIds: Array.isArray(u.categoryIds) ? [...new Set(u.categoryIds.filter(Boolean))] : [],
  })).filter((u) => u.name);
  return { users };
}

export default async function handler(req, res) {
  // GET requires a verified admin session; team-list writes require Owner access.
  if (req.method === 'GET') {
    if (!(await requireAdminOrOrderToken(req, res))) return;
  } else if (!(await requireOwner(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    try {
      let data = await readSiteConfigJson(USERS_FILE, null);
      if (!data?.users?.length) {
        data = defaultFulfillmentUsers();
        await writeSiteConfigJson(USERS_FILE, data);
      }
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Failed to load fulfillment users' });
    }
  }

  if (req.method === 'POST') {
    try {
      const data = normalizeUsers(req.body || {});
      if (!data.users.length) return res.status(400).json({ error: 'At least one user is required' });
      await writeSiteConfigJson(USERS_FILE, data);
      return res.status(200).json(data);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Failed to save fulfillment users' });
    }
  }

  return res.status(405).end();
}
