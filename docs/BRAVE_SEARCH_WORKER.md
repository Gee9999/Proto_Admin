# Brave Search worker contract

Only a separate server-side worker may read `BRAVE_SEARCH_API_KEY`; it is never exposed to the browser or Vercel client bundle.

For each queued job the worker makes a maximum of 50 Brave Search API requests, uses `country=ZA` and `search_lang=en`, records the exact request count, and stops when the configured US$0.25 budget would be exceeded. It must deduplicate by canonical domain, suppress existing Proto customers, respect robots.txt and page limits, and never perform enrichment or outreach. A worker marks a job completed, partial, or failed with its audit evidence.
