# Apollo analytics recommendations — preview scope

The Analytics → Apollo Insights tab is a read-only advisory layer. It combines
the existing search analytics and order analytics endpoints in the browser and
turns repeated signals into staff-review prompts.

## Signals currently covered

- repeated no-result searches (three or more occurrences);
- products with meaningful tracked views but no matching ordered product;
- ordered products with no tracked view event (instrumentation/discoverability check);
- categories with views but no orders;
- low online ordering participation among approved customers.

Each result includes priority, evidence, and a suggested review. It never calls
an outbound provider, edits catalogue data, changes a customer, creates an
order, or sends a campaign.

## Apollo/Hermes handoff

`buildApolloRecommendations()` is intentionally deterministic and dependency-free
so the preview is useful even when no model key or runner is configured. A later
Apollo worker may consume the returned recommendation objects for explanation or
ranking, but must preserve the `advisory: true` contract and require a human
review before any operational action.

The current browser layer does not expose Supabase credentials or customer rows;
it consumes the already-authorised Admin API responses only.

## Verification

`tests/apollo-recommendations.test.js` covers no-result gaps, viewed-without-order
signals, customer engagement, and the no-outbound-action contract.
