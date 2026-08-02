# Customer Analysis Phase 1

## Purpose

Give staff a reliable 30-second view of a customer's trading history before introducing predictions or automated actions.

## Included

- Versioned `customer-iq.v1` data contract.
- Transparent health classification: growing, active, stable, declining, dormant, or insufficient data.
- Customer tenure, recent activity, current-year and prior-year spend, growth, lifetime spend, invoice statistics, buying rhythm, favourite departments, favourite products, monthly spend, timeline, source and freshness.
- Responsive `CustomerAnalysisPanel` component.
- Preview fixture for UI development while the bounded read-only SQL endpoint is completed.
- Unit tests for date arithmetic, growth, dormant precedence, explanations and contract versioning.

## Intended integration point

Render `CustomerAnalysisPanel` at the top of the existing customer profile/edit experience, above contact and account-edit fields:

```jsx
import CustomerAnalysisPanel from '../components/CustomerAnalysisPanel';
import { buildCustomerAnalysis } from '../lib/customerIq';

<CustomerAnalysisPanel analysis={buildCustomerAnalysis(customer.customerIq || customer)} />
```

The live API must return the same contract and should be populated by approved, bounded, parameterised read-only SQL bridge reports. The browser must not submit arbitrary SQL.

## Safety

- No writes to POSWINSQL.
- No automatic customer contact or task creation.
- No credit, approval or account decisions.
- Missing data is shown honestly.
- Every health label includes a deterministic explanation.
