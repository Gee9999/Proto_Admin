import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('engagement analytics preview', () => {
  const component = fs.readFileSync(path.resolve(process.cwd(), 'src/components/EngagementAnalyticsTabs.jsx'), 'utf8');
  const comms = fs.readFileSync(path.resolve(process.cwd(), 'src/components/CommsPanel.jsx'), 'utf8');

  it('exposes the requested read-only engagement tabs', () => {
    for (const label of ['Not opened', 'Opened', 'Repeat customers', 'First-time', 'Inactive 90d+', 'High-value']) {
      expect(component).toContain(label);
    }
    expect(comms).toContain("setTab('engagement')");
    expect(comms).toContain('<EngagementAnalyticsTabs');
  });

  it('uses read-only GET requests and does not send or mutate customers', () => {
    expect(component).toContain("fetch('/api/email-campaigns')");
    expect(component).toContain('fetch(`/api/admin-customers?tab=regular');
    expect(component).not.toContain("method: 'POST'");
    expect(component).not.toContain("method: 'PATCH'");
    expect(component).not.toContain("method: 'DELETE'");
    expect(component).toContain('No messages are sent from this view.');
  });
});
