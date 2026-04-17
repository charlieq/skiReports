# Getting Started

This project generates a daily ski report for **Paradise at Mount Rainier** by scraping road status, mountain weather, avalanche conditions, and live snow depth data from the NRCS SNOTEL station, then using the Anthropic Claude API to produce a clear go / no-go recommendation.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js 18+** | Built-in `fetch` is required; check with `node -v` |
| **npm** | Comes with Node |
| **Anthropic API key** | Get one at [console.anthropic.com](https://console.anthropic.com/) |

---

## Setup

### 1. Install dependencies

```bash
cd code
npm install
```

> `npm install` will also download Chromium for Puppeteer (used to render the NWAC avalanche forecast page). This is a ~300 MB one-time download.

### 2. Configure your API key

```bash
# From the project root
cp example.env .env
```

Open `.env` and replace `your_anthropic_api_key_here` with your real Anthropic API key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

The `.env` file is listed in `.gitignore` and will never be committed.

### 3. (Optional) Choose a Claude model

By default the script uses `claude-opus-4-6`. To use a different model, uncomment and set `ANTHROPIC_MODEL` in `.env`:

```
ANTHROPIC_MODEL=claude-opus-4-6
```

---

## Running the Script

```bash
cd code
node generateReport.js
```

The script takes roughly **60–90 seconds** (Puppeteer needs time to render the NWAC page).

You will see progress output like:

```
=== Paradise Ski Report Generator ===

[1/4] Checking Paradise road status (NPS)…
      Road: OPEN (no closure alerts found)

[2/4] Fetching mountain weather forecast (UW Atmos)…
[3/4] Fetching avalanche forecast (NWAC)…
[4/4] Fetching snow depth data (NRCS SNOTEL)…
      Snow depth: 95 in (+14 in) as of 2026-04-16

[5/5] Composing final report…

Report saved to: skiReports/paradiseSkiReport-20260416.md
=== Done ===
```

---

## Output

Reports are saved to the `skiReports/` directory as:

```
skiReports/paradiseSkiReport-YYYYMMDD.md
```

Open the file in any markdown viewer, VS Code, or Obsidian.

---

## Troubleshooting

**`Error: ANTHROPIC_API_KEY is not set`**
→ Make sure you created `.env` from `example.env` and added your key.

**Puppeteer / Chromium download hangs**
→ Run `cd code && npm install` with a stable internet connection. If you are behind a proxy, set the `HTTPS_PROXY` environment variable.

**`HTTP 403` or `HTTP 429` errors**
→ The NPS or UW pages may be rate-limiting. Wait a minute and try again.

**NWAC forecast is empty / shows placeholder text**
→ The NWAC SPA may have updated. See [docs/nextSteps.md](docs/nextSteps.md) item #2 for debugging steps.

**Snow depth shows `null` / "data unavailable"**
→ The NRCS SNOTEL CSV endpoint may be temporarily down. Check `https://wcc.sc.egov.usda.gov` directly; the report will still generate using the other three sources.

---

## Project Structure

```
skiReports/
├── code/
│   ├── generateReport.js   ← main script
│   └── package.json
├── skiReports/             ← generated reports saved here
├── docs/
│   ├── summary.md          ← how the project works
│   └── nextSteps.md        ← future improvements
├── example.env             ← template — copy to .env
├── .gitignore
└── gettingStarted.md       ← this file
```
