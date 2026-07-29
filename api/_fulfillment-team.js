import { readSiteConfigJson } from './_site-config.js';
import { defaultFulfillmentUsers } from './_fulfillment-defaults.js';
import { normalizePhone } from './_phone.js';

const USERS_FILE = 'fulfillment/users.json';

let cachedPhones = null;
let cachedAt = 0;
const CACHE_MS = 60_000;

export async function loadFulfillmentTeamPhones() {
  if (cachedPhones && Date.now() - cachedAt < CACHE_MS) return cachedPhones;

  let data = await readSiteConfigJson(USERS_FILE, null);
  if (!data?.users?.length) data = defaultFulfillmentUsers();

  const phones = new Set();
  (data.users || []).forEach((user) => {
    const normalized = normalizePhone(user.whatsapp || '');
    if (normalized) phones.add(normalized);
  });

  cachedPhones = phones;
  cachedAt = Date.now();
  return phones;
}

export async function isFulfillmentTeamPhone(phone) {
  const normalized = normalizePhone(phone || '');
  if (!normalized) return false;
  const team = await loadFulfillmentTeamPhones();
  return team.has(normalized);
}
