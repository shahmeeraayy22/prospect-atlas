# Prospect Atlas Local Business Leads

Find local businesses by category and location. Export deduplicated names, addresses, phone numbers, websites, ratings, review counts, coordinates, Maps links and optional public website emails.

## Example input

```json
{"searchTerms":["plumbers"],"location":"Austin, Texas, USA","maxResults":50,"collectEmails":false,"maxRunSeconds":300,"proxyConfiguration":{"useApifyProxy":false}}
```

Start with one category and a small run. Location is appended to each search term; it is not a strict radius filter. Results are a search sample, not a complete business directory. Use a suitable proxy when direct cloud access is blocked.

## Output

Each default dataset row represents a unique business: `businessId`, `businessName`, `category`, `address`, `phone`, `website`, `rating`, `reviewCount`, `latitude`, `longitude`, `googleMapsUrl`, `placeId`, `emails`, `emailCollectionStatus`, `locationQuery`, `scrapedAt`. Download through Apify's dataset export tools. Missing fields are null. Branches retain their own place identities. Email collection is best effort, not email verification.

`RUN-SUMMARY` in the default key-value store records counts, timestamps and the stopping reason. Results are saved incrementally. A time limit can produce a partial dataset. Zero usable results fail the run explicitly; a failed run can still have previously saved results. Migration/interruption preserves delivered rows but does not resume unfinished collection; disable automatic migration for this initial version where available.

## Limits and cost

Up to 10 search terms, 1,000 delivered businesses, 30 minutes of scraping and four concurrent pages. The result limit stops further collection once reached; searches may retrieve extra in-flight pages. Set the platform timeout above `maxRunSeconds` (at least 60 extra seconds). Start with 2 GB memory and concurrency two. Browser startup, proxy use, optional email enrichment, and retries affect cost. This Actor does not guarantee rankings, coverage, deliverable email addresses, or marketing opportunity scores.

## Developer deployment

Connect this Git repository to an Apify Actor, use `.actor/actor.json`, and build. The dedicated Dockerfile builds the existing Go engine and a small Apify SDK adapter. The local dashboard's Dockerfile remains independent. For local adapter checks: `cd apify && npm ci && npm test`. Build the cloud image from the repository root: `docker build -f .actor/Dockerfile -t prospect-atlas-apify .`.

Run locally with input at `/app/storage/key_value_stores/default/INPUT.json` in a mounted storage directory. `SCRAPER_BINARY` can point to a locally built engine for non-Docker development.

## Monetization setup

Validate privately before publishing. Configure exactly one custom pay-per-event event named `business-result`, representing one delivered unique business. The adapter uses the SDK's combined dataset/charging operation and stops at the charge limit. Do not also price the default dataset-item event: that would charge twice for the same result. Set the price only after measuring real cloud runs; select whether platform usage is included. Complete billing/payout setup in Apify Console. Publishing and prices are account settings, not activated by this repository.

## License and sources

Based on the MIT-licensed gosom/google-maps-scraper. Original copyright and license are retained in LICENSE. Respect applicable data-source terms and permitted data use. The code license does not grant rights to third-party data. Upstream telemetry is disabled in this Actor.
