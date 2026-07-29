import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const usersApiSource = fs.readFileSync(new URL('../api/fulfillment-users.js', import.meta.url), 'utf8');
const testApiSource = fs.readFileSync(new URL('../api/team-whatsapp-test.js', import.meta.url), 'utf8');
const modalSource = fs.readFileSync(new URL('../src/components/FulfillmentSettingsModal.jsx', import.meta.url), 'utf8');

test('fulfilment users default to active order alerts unless explicitly disabled', () => {
  assert.match(usersApiSource, /orderAlerts:\s*u\.orderAlerts !== false/);
  assert.match(modalSource, /orderAlerts:\s*u\.orderAlerts !== false/);
});

test('the team settings UI saves an explicit order-alert switch', () => {
  assert.match(modalSource, /Order alerts active/);
  assert.match(modalSource, /updateUser\(idx,\s*\{\s*orderAlerts:\s*e\.target\.checked\s*\}\)/);
  assert.match(modalSource, /u\.orderAlerts && !isValidWatiPhone/);
});

test('WhatsApp tests skip team members whose order alerts are disabled', () => {
  assert.match(testApiSource, /\.filter\(\(u\) => u\?\.orderAlerts !== false\)/);
});
