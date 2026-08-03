import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import CustomerIntelligenceWorkspace from '../src/components/CustomerIntelligenceWorkspace';

const source = readFileSync(new URL('../src/components/CustomerIntelligenceWorkspace.jsx', import.meta.url), 'utf8');

describe('Customer Intelligence Workspace', () => {
  it('renders the staff action, evidence bands and explicit decision safeguard', () => {
    const html = renderToStaticMarkup(
      React.createElement(CustomerIntelligenceWorkspace, {
        customer: {
          id: 'customer-1',
          is_approved: true,
          business_name: 'Creative Corner',
          name: 'Kira Buyer',
          customer_code: 'CREATE',
          email: 'buyer@example.test',
          phone: '0210000000',
          monthly_spend: 'R10,000 – R25,000',
          sales_channels: ['Physical retail store'],
          product_categories: ['Art, craft & beads'],
          business_description: 'We run workshops and sell craft kits.',
        },
        orders: [],
        totalOrders: 0,
        source: 'portal',
      }),
    );

    expect(html).toContain('Customer intelligence workspace');
    expect(html).toContain('Recommended next staff action');
    expect(html).toContain('Help with a first order');
    expect(html).toContain('Trader confidence');
    expect(html).toContain('Customer potential');
    expect(html).toContain('Engagement health');
    expect(html).toContain('Not enough data');
    expect(html).toContain('Data confidence');
    expect(html).toContain('never approves, declines, contacts or changes a customer');
    expect(html).not.toContain('100%');
  });

  it('labels a partial portal-order window honestly', () => {
    const html = renderToStaticMarkup(
      React.createElement(CustomerIntelligenceWorkspace, {
        customer: { id: 'customer-2', is_approved: true, business_name: 'Busy Store' },
        orders: [{ id: 'order-1', created_at: '2026-08-01', total_ex_vat: 500 }],
        totalOrders: 12,
        source: 'portal',
      }),
    );

    expect(html).toContain('Showing the latest 1 of 12 portal orders');
    expect(html).toContain('partial');
  });

  it('defines accessible tabs and keeps staff approval outside the workspace', () => {
    expect(source).toContain('role="tablist"');
    expect(source).toContain('role="tab"');
    expect(source).toContain("['ArrowLeft', 'ArrowRight', 'Home', 'End']");
    expect(source).toContain('Staff notes and follow-ups are not connected yet');
    expect(source).not.toContain('approveCustomer');
    expect(source).not.toContain('sendCustomerEmailBroadcast');
  });
});
