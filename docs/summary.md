# Paradise Ski Report – Project Summary

## What This Project Does

This Node.js script answers the question **"Can I go skiing at Paradise today?"** by automatically gathering three sources of information, summarising them with the Anthropic Claude API, and producing a dated markdown report.

---

## Architecture Overview

```
skiReports/
├── code/
│   ├── generateReport.js   ← main script
│   └── package.json
├── skiReports/             ← generated reports land here
├── docs/
│   ├── summary.md          ← this file
│   └── nextSteps.md
├── .env                    ← your API key (not committed)
├── example.env             ← template for .env
├── .gitignore
└── gettingStarted.md
```

---

## Data Sources & How Each Is Handled

### 1. NPS Mount Rainier – Conditions Page
- **URL:** `https://www.nps.gov/mora/planyourvisit/conditions.htm`
- **Method:** Plain `fetch()` + Cheerio HTML parsing
- **Logic:** Scans block-level elements (`p`, `li`, alert `div`s, table cells) for text that mentions "Paradise" or "Nisqually" (the approach road). If a closure keyword is found the road is flagged **CLOSED**; otherwise it is reported **OPEN** (NPS only posts alerts when something is wrong, so silence = open).
- **Output:** A boolean `open` flag plus any raw alert text.

### 2. UW Atmospheric Sciences – Rainier Weather Report
- **URL:** `https://a.atmos.washington.edu/data/rainier_report.html`
- **Method:** Plain `fetch()` + Cheerio to extract all visible text
- **LLM Step:** Full raw text is sent to the Anthropic API with a prompt asking for a concise 3–5 bullet-point summary focused on Paradise (~5,400 ft) conditions for today and tomorrow.
- **Output:** Markdown bullet-point weather summary.

### 3. NWAC – Avalanche Forecast
- **URL:** `https://nwac.us/avalanche-forecast/#/west-slopes-south`
- **Method:** Puppeteer headless browser (the NWAC site is a React SPA; a plain `fetch()` only returns the HTML shell, not the forecast data)
- **LLM Step:** The rendered page text is trimmed to 8,000 characters and sent to the Anthropic API with a prompt asking for a 3–5 bullet-point avy summary covering danger rating, avalanche problems, and travel advice.
- **Output:** Markdown bullet-point avalanche summary.

### 4. NRCS SNOTEL – Snow Depth & SWE
- **URL:** `https://wcc.sc.egov.usda.gov/reportGenerator/view_csv/customSingleStationReport/daily/679:wa:SNTL|...`
- **Method:** Plain `fetch()` against the NRCS report generator CSV endpoint (no scraping needed — the endpoint returns clean CSV)
- **Data:** Last 7 days of Snow Depth (in), Change in Snow Depth (in), Snow Water Equivalent (in), and Change in SWE (in) from the Paradise SNOTEL station (679) at 5,150 ft
- **Output:** Most recent day's snow depth & SWE values plus a 7-day markdown table included in the final report prompt.

### 5. Final Report Generation
- The road status, weather summary, avy summary, and snow depth data are combined into a structured prompt.
- Claude produces a full markdown report answering "Should I go skiing?" with a **YES / MAYBE / NO** recommendation, section-by-section breakdown (including a Snow Conditions section), and safety tips.
- The report is saved to `skiReports/paradiseSkiReport-YYYYMMDD.md` with a UTC timestamp and source links at the bottom.

---

## Key Technical Decisions

| Decision | Rationale |
|---|---|
| Puppeteer for NWAC | NWAC is a React SPA; static fetch only returns empty shell |
| Cheerio for NPS & UW | Both are server-rendered static HTML; no JS needed |
| CSV endpoint for SNOTEL | NRCS provides a clean CSV report-generator URL; no HTML parsing or headless browser needed |
| Claude for all LLM tasks | Single API, consistent quality; model configurable via `.env` |
| Separate `.env` + `example.env` | Keeps API keys out of version control |
| Reports in `skiReports/` subdir | Keeps generated output separate from source code |

---

## Dependencies

| Package | Purpose |
|---|---|
| `@anthropic-ai/sdk` | Anthropic Claude API client |
| `cheerio` | Server-side HTML parsing / jQuery-like selectors |
| `dotenv` | Load `.env` into `process.env` |
| `puppeteer` | Headless Chromium for JavaScript-rendered pages |

> **SNOTEL note:** The NRCS report-generator CSV endpoint requires no additional npm package — Node's built-in `fetch` handles it directly.
