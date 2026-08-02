import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function source(path) {
  return readFileSync(path, 'utf8');
}

describe('intelligence and admin safety contracts', () => {
  it('bounds the catalogue remediation queue and exposes a hard publish stop', () => {
    const api = source('api/backend-health.js');
    const panel = source('src/components/BackendHealthPanel.jsx');
    expect(api).toMatch(/UNSAFE_PRODUCT_LIMIT = 25/);
    expect(api).toMatch(/publishStop: safety\.state === 'critical'/);
    expect(api).toMatch(/unsafeProducts\.length < UNSAFE_PRODUCT_LIMIT/);
    expect(panel).toMatch(/Hard publish stop/);
    expect(panel).toMatch(/onOpenProductManager/);
  });

  it('makes the team editor a labelled, keyboard-contained modal', () => {
    const modal = source('src/components/FulfillmentSettingsModal.jsx');
    expect(modal).toMatch(/role="dialog"/);
    expect(modal).toMatch(/aria-modal="true"/);
    expect(modal).toMatch(/event\.key === 'Escape'/);
    expect(modal).toMatch(/event\.key !== 'Tab'/);
    expect(modal).toMatch(/document\.body\.style\.overflow = 'hidden'/);
    expect(modal).toMatch(/openerRef\.current\?\.focus/);
    expect(modal).toMatch(/htmlFor={`team-name-/);
    expect(modal).toMatch(/htmlFor={`team-phone-/);
  });

  it('resets scroll and focuses the visible section heading after menu changes', () => {
    const page = source('src/pages/AdminPage.jsx');
    expect(page).toMatch(/previousSectionRef/);
    expect(page).toMatch(/window\.scrollTo\(\{ top: 0, behavior: 'instant' \}\)/);
    expect(page).toMatch(/heading\.focus\(\{ preventScroll: true \}\)/);
  });

  it('keeps filtered featured lists searchable, compact and non-reorderable', () => {
    const panel = source('src/components/FeaturedPanel.jsx');
    const css = source('src/index.css');
    expect(panel).toMatch(/Search featured products/);
    expect(panel).toMatch(/reorderDisabled={Boolean\(arrangeSearch\)}/);
    expect(panel).toMatch(/onError=\{\(\) => setFailed\(true\)\}/);
    expect(css).toMatch(/\.featured-order-row \{ min-height: 54px/);
  });

  it('guards analytics interpretation, PII and destructive clearing', () => {
    const orders = source('src/components/OrderAnalyticsDashboard.jsx');
    const searches = source('src/components/SearchAnalyticsDashboard.jsx');
    expect(orders).toMatch(/Low sample size/);
    expect(orders).toMatch(/Reveal customer details/);
    expect(orders).toMatch(/clearPhrase !== 'CLEAR ANALYTICS'/);
    expect(orders).toMatch(/Export revealed customer names and email addresses/);
    expect(searches).toMatch(/Journey tracking is incomplete/);
  });

  it('shows image, source freshness and ERP variance in product intelligence', () => {
    const contract = source('api/_product-intelligence.js');
    const panel = source('src/components/ProductIntelligencePanel.jsx');
    expect(contract).toMatch(/sourceMeta/);
    expect(contract).toMatch(/updated_at/);
    expect(panel).toMatch(/intelligence-product-image/);
    expect(panel).toMatch(/Source age/);
    expect(panel).toMatch(/Price variance vs ERP \+ VAT/);
    expect(panel).toMatch(/Available-stock variance/);
    expect(panel).toMatch(/incomplete source coverage/);
  });

  it('labels Buying as a preview and makes Hermes exception-led', () => {
    const buying = source('src/components/BuyingPanel.jsx');
    const hermes = source('src/components/HermesPanel.jsx');
    expect(buying).toMatch(/Foundation Preview/);
    expect(buying).toMatch(/Use Product Intelligence now/);
    expect(hermes).toMatch(/Operational exceptions/);
    expect(hermes).toMatch(/api\/backend-health/);
    expect(hermes).toMatch(/Open Backend Health/);
  });
});
