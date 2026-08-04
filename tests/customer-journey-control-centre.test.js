import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(new URL('../src/pages/AdminPage.jsx', import.meta.url), 'utf8');
const sidebar = fs.readFileSync(new URL('../src/components/GroupedSidebar.jsx', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../src/components/CustomerJourneyControlCentre.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../api/customer-journey-control.js', import.meta.url), 'utf8');

describe('Customer Journey Control Centre', () => {
  it('is a dedicated Admin section with explicit read-only language', () => {
    expect(sidebar).toContain("id: 'customer-journey'");
    expect(page).toContain('CustomerJourneyControlCentre');
    expect(panel).toContain('No customer record can be changed here');
    expect(panel).toContain('never approves customers, sends messages or changes orders');
  });

  it('returns aggregates without customer identifiers or mutation methods', () => {
    expect(api).toContain("req.method !== 'GET'");
    expect(api).toContain("select('journey,event_type,outcome,created_at')");
    expect(api).not.toMatch(/customer_id|email|phone|session_id/);
    expect(api).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
  });
});
