import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(new URL('../src/components/EmailAnalyticsPanel.jsx', import.meta.url), 'utf8');

describe('email campaign delivery analytics', () => {
  it('derives delivered emails from Brevo-accepted sends less bounces', () => {
    expect(source).toMatch(/const delivered = Math\.max\(0, sent - bounced\);/);
  });

  it('does not use the inconsistent delivered webhook event as the displayed delivery count', () => {
    expect(source).not.toMatch(/const delivered = e\.delivered \|\| 0;/);
  });

  it('explains the delivery calculation in the dashboard', () => {
    expect(source).toContain('Delivered means emails accepted by Brevo, less recorded bounces.');
  });
});
