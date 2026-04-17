# Next Steps

Ranked roughly by priority.

---

## 1. Validate & Harden the NPS Scraper

The NPS conditions page HTML structure can change without notice. The current scraper casts a wide net with heuristic element matching.

**To do:**
- Run the script once and inspect `rawSnippets` in the output to confirm the right elements are being captured.
- If the page structure doesn't match, open DevTools on `https://www.nps.gov/mora/planyourvisit/conditions.htm` and identify the exact CSS selectors for alert banners and road-condition entries; update the Cheerio selectors in `getParadiseRoadStatus()`.
- Consider adding a fallback: if scraping yields no text at all, log a warning and treat road as unknown (rather than defaulting to open).

---

## 2. Validate the NWAC Avalanche Forecast

The NWAC SPA may update its class names or load patterns. Puppeteer currently waits for selectors that match forecast-related classes.

**To do:**
- Run the script and inspect what text is actually being captured from the NWAC page (add a `console.log(trimmed)` in `getAvySummary` temporarily).
- Ensure the West Slopes South zone data is present in the extracted text. If not, check whether NWAC has added authentication or changed routing.
- Alternatively, explore the NWAC public API (they publish zone forecast JSON at known endpoints) to replace the Puppeteer scrape with a direct API call.

---

## 3. Add Scheduling / Automation

Right now the script must be run manually.

**Options:**
- **cron job** – Add a crontab entry to run `node generateReport.js` each morning (e.g., 6 AM).
- **GitHub Actions** – Schedule a workflow to run the script and commit the report automatically.
- **Claude Code `schedule` skill** – Use the built-in schedule skill to set up a recurring agent run.

---

## 4. Snow Depth / Current Snowpack Data ✅ Done

Snow depth and SWE are now fetched from the NRCS SNOTEL station 679 (Paradise, 5,150 ft) via the report-generator CSV endpoint. The 7-day table and most recent day's values are included in the report and passed to Claude as part of the final summary prompt.

**Potential enhancements:**
- Also display peak-season historical averages for context (the same NRCS endpoint supports longer date ranges).
- Integrate the [NWS point forecast](https://forecast.weather.gov/) API for a structured machine-readable weather forecast as a complement to the UW report.

---

## 5. Lift & Facility Status

Paradise has a ski rental area and a snowplay zone. Whether the ranger station and facilities are open affects the trip.

**To do:**
- Scrape or check the NPS Paradise Visitor Center hours/status and include in the report.

---

## 6. Error Handling & Retries

- Wrap each data-fetch step in a retry loop (e.g., 2 retries with exponential back-off) so transient network errors don't kill the whole run.
- Send an alert (email, Slack, iMessage) if the script fails entirely.

---

## 7. Output Formats

- Add an HTML version of the report for easier reading in a browser.
- Send the report as an email or iMessage automatically after generation.

---

## 8. Historical Report Archive

- Add an index page (`skiReports/index.md`) that lists all past reports with links.
- Consider pushing reports to a static-site host (GitHub Pages, Netlify) for easy web access.

---

## 9. Testing

- Add unit tests for the NPS scraper (mock HTML fixtures from the real page).
- Add integration tests that run against live URLs and validate non-empty output.

---

## 10. Security & Maintenance

- Pin exact dependency versions in `package-lock.json` (run `npm install` to generate).
- Set up Dependabot or `npm audit` in CI to catch vulnerable packages.
- Rotate the Anthropic API key periodically and ensure it has appropriate usage limits set in the Anthropic console.
