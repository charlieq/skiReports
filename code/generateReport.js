/**
 * Paradise Ski Report Generator
 *
 * Fetches road status, mountain weather, and avalanche conditions for
 * Paradise at Mount Rainier, then uses the Anthropic API to produce a
 * human-readable ski report saved to the skiReports directory.
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Anthropic = require('@anthropic-ai/sdk');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-6';

const URLS = {
  npsConditions: 'https://www.nps.gov/mora/planyourvisit/conditions.htm',
  uwWeather: 'https://a.atmos.washington.edu/data/rainier_report.html',
  nwacAvy: 'https://nwac.us/avalanche-forecast/#/west-slopes-south',
  snotel:
    'https://wcc.sc.egov.usda.gov/reportGenerator/view_csv/customSingleStationReport/daily/' +
    '679:wa:SNTL|id=%22%22|name/-7,0/WTEQ::value,WTEQ::delta,SNWD::value,SNWD::delta',
};

const REPORTS_DIR = path.join(__dirname, '../skiReports');

// ---------------------------------------------------------------------------
// Anthropic client (lazy — validated before use)
// ---------------------------------------------------------------------------

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Copy example.env to .env and add your key.'
    );
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ---------------------------------------------------------------------------
// Helper: plain fetch with a realistic User-Agent
// ---------------------------------------------------------------------------

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/123.0 Safari/537.36',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

// ---------------------------------------------------------------------------
// 1. NPS – Paradise road status
// ---------------------------------------------------------------------------

/**
 * Scrapes the Mount Rainier NPS conditions page and returns the road status
 * for the Paradise corridor. If no alert is found the road is assumed open.
 *
 * @returns {{ open: boolean, alertText: string | null, rawSnippets: string[] }}
 */
async function getParadiseRoadStatus() {
  console.log('  Fetching NPS conditions page…');
  const html = await fetchPage(URLS.npsConditions);
  const $ = cheerio.load(html);

  // Collect text from any element that looks like an alert or road-condition entry
  const snippets = [];

  // NPS uses .alert, .GeneralAlertBanner, li elements in road-condition lists, etc.
  // Cast a wide net: any block-level element whose text mentions "Paradise" or
  // "Nisqually" (the approach road) or "road" + "closed|open|status".
  const PARADISE_RE = /paradise|nisqually/i;
  const ROAD_STATUS_RE = /road|route|closed|closure|open/i;

  $('p, li, div.alert, div[class*="alert"], div[class*="condition"], td, h2, h3, h4').each(
    (_, el) => {
      const text = $(el).clone().children().remove().end().text().trim();
      if (!text) return;
      if (PARADISE_RE.test(text) || (ROAD_STATUS_RE.test(text) && PARADISE_RE.test($(el).closest('section, article, div').text()))) {
        snippets.push(text);
      }
    }
  );

  // Deduplicate and keep only short, specific snippets
  const seen = new Set();
  const deduped = snippets.filter((s) => {
    if (seen.has(s) || s.length > 600) return false;
    seen.add(s);
    return true;
  });

  if (deduped.length === 0) {
    return { open: true, alertText: null, rawSnippets: [] };
  }

  // Determine open/closed from snippet text
  const allText = deduped.join(' ').toLowerCase();
  const isClosed =
    /closed|closure|not open|restricted|prohibited/.test(allText) &&
    !/road is open|currently open/.test(allText);

  return { open: !isClosed, alertText: deduped.join('\n'), rawSnippets: deduped };
}

// ---------------------------------------------------------------------------
// 2. UW Atmospheric Sciences – mountain weather forecast
// ---------------------------------------------------------------------------

/**
 * Downloads the University of Washington Rainier weather report and asks
 * Claude to distil it into a concise today/tomorrow summary.
 *
 * @returns {string} Weather summary markdown
 */
async function getWeatherSummary(client) {
  console.log('  Fetching UW Rainier weather report…');
  const html = await fetchPage(URLS.uwWeather);
  const $ = cheerio.load(html);

  // The page is a simple pre-formatted text page; grab all visible text.
  const rawText = $.text().replace(/\s{3,}/g, '\n\n').trim();

  console.log('  Asking Claude for weather summary…');
  const message = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content:
          'You are a helpful mountain weather assistant. Below is the latest ' +
          'Mount Rainier weather report from the University of Washington. ' +
          'Please write a concise markdown summary (3-5 bullet points) ' +
          'covering conditions for TODAY and TOMORROW at Paradise (~5,400 ft) ' +
          'and the upper mountain. Focus on: temperature, wind, precipitation, ' +
          'visibility/cloud cover, and any hazards. Use plain language a skier ' +
          'would appreciate.\n\n---\n' +
          rawText,
      },
    ],
  });

  return message.content[0].text;
}

// ---------------------------------------------------------------------------
// 3. NWAC – avalanche forecast
// ---------------------------------------------------------------------------

/**
 * Uses a headless browser to render the NWAC SPA, extracts the forecast text,
 * and asks Claude to summarise the avalanche danger and key concerns.
 *
 * @returns {string} Avalanche summary markdown
 */
async function getAvySummary(client) {
  console.log('  Launching headless browser for NWAC forecast…');
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  let rawText = '';
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/123.0 Safari/537.36'
    );

    await page.goto(URLS.nwacAvy, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for forecast content – NWAC renders danger ratings and text into
    // elements with these class patterns once the SPA has loaded.
    await page
      .waitForSelector('[class*="forecast"], [class*="danger"], [class*="problem"], main', {
        timeout: 20000,
      })
      .catch(() => {
        /* fall through with whatever rendered */
      });

    rawText = await page.evaluate(() => document.body.innerText);
  } finally {
    await browser.close();
  }

  if (!rawText.trim()) {
    return '_Could not retrieve NWAC forecast. Check the site manually._';
  }

  // Trim to a reasonable size to stay within token limits
  const trimmed = rawText.slice(0, 8000);

  console.log('  Asking Claude for avalanche summary…');
  const message = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content:
          'You are an avalanche safety expert. Below is the current NWAC ' +
          '(Northwest Avalanche Center) avalanche forecast for the West Slopes ' +
          'South zone, which covers Mount Rainier / Paradise. ' +
          'Write a concise markdown summary (3-5 bullet points) of: ' +
          '(1) the overall danger rating, ' +
          '(2) the primary avalanche problems, ' +
          '(3) any specific terrain or travel advice. ' +
          'Use plain language a backcountry skier would understand.\n\n---\n' +
          trimmed,
      },
    ],
  });

  return message.content[0].text;
}

// ---------------------------------------------------------------------------
// 4. NRCS SNOTEL – snow depth & SWE at Paradise (station 679)
// ---------------------------------------------------------------------------

/**
 * Fetches the last 7 days of SNOTEL data for the Paradise station (679) and
 * returns the most recent day's snow depth and SWE values plus the 7-day table.
 *
 * @returns {{
 *   date: string,
 *   snowDepthIn: number | null,
 *   snowDepthChangeIn: number | null,
 *   sweIn: number | null,
 *   sweChangeIn: number | null,
 *   tableText: string
 * }}
 */
async function getSnowDepth() {
  console.log('  Fetching SNOTEL snow depth data (NRCS station 679)…');
  const csv = await fetchPage(URLS.snotel);

  // The CSV has comment lines starting with # before the header row.
  const lines = csv
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  if (lines.length < 2) {
    return { date: 'N/A', snowDepthIn: null, snowDepthChangeIn: null, sweIn: null, sweChangeIn: null, tableText: '' };
  }

  // Build a markdown table from all data rows for the report
  const headers = lines[0].split(',');
  const dataRows = lines.slice(1).map((l) => l.split(','));

  const tableLines = [
    '| ' + headers.join(' | ') + ' |',
    '|' + headers.map(() => '---').join('|') + '|',
    ...dataRows.map((r) => '| ' + r.join(' | ') + ' |'),
  ];
  const tableText = tableLines.join('\n');

  // Most recent row
  const latest = dataRows[dataRows.length - 1];
  const parse = (v) => (v && v !== 'null' && v !== '' ? parseFloat(v) : null);

  return {
    date: latest[0] ?? 'N/A',
    sweIn: parse(latest[1]),
    sweChangeIn: parse(latest[2]),
    snowDepthIn: parse(latest[3]),
    snowDepthChangeIn: parse(latest[4]),
    tableText,
  };
}

// ---------------------------------------------------------------------------
// 5. Final report – "Should I go skiing?"
// ---------------------------------------------------------------------------

/**
 * Combines road status, weather, avy, and snow depth data and asks Claude to
 * produce a final recommendation report in markdown.
 *
 * @param {{ open: boolean, alertText: string | null }} roadStatus
 * @param {string} weatherSummary
 * @param {string} avySummary
 * @param {{ date: string, snowDepthIn: number|null, snowDepthChangeIn: number|null, sweIn: number|null, sweChangeIn: number|null, tableText: string }} snowDepth
 * @returns {string} Full markdown report
 */
async function generateFinalReport(client, roadStatus, weatherSummary, avySummary, snowDepth) {
  console.log('  Generating final ski report…');

  const roadSection = roadStatus.open
    ? `**Paradise Road Status: OPEN**\n${roadStatus.alertText ? '\nNote: ' + roadStatus.alertText : ''}`
    : `**Paradise Road Status: CLOSED / RESTRICTED**\n\n${roadStatus.alertText}`;

  const snowDepthSection = snowDepth.snowDepthIn !== null
    ? `**As of ${snowDepth.date}:** Snow Depth: **${snowDepth.snowDepthIn} in** (${snowDepth.snowDepthChangeIn >= 0 ? '+' : ''}${snowDepth.snowDepthChangeIn} in from prior day) | SWE: ${snowDepth.sweIn} in (${snowDepth.sweChangeIn >= 0 ? '+' : ''}${snowDepth.sweChangeIn} in)\n\n${snowDepth.tableText}`
    : '_Snow depth data unavailable._';

  const prompt = `You are an expert ski guide and mountain safety advisor for Mount Rainier's
Paradise area. Given the following conditions, write a comprehensive ski report in markdown
that answers the question "Should I go skiing at Paradise today?"

The report should include:
1. A clear YES / MAYBE / NO recommendation with a brief reason
2. Road Access section
3. Weather section
4. Avalanche Conditions section
5. Snow Conditions section (include the snow depth and SWE figures prominently)
6. Overall Safety & Tips section

Be direct, practical, and safety-conscious. Format nicely for markdown.

---
## Road Status
${roadSection}

## Weather Forecast
${weatherSummary}

## Avalanche Forecast
${avySummary}

## Snow Depth & Snowpack (NRCS SNOTEL Station 679 – Paradise, 5,150 ft)
${snowDepthSection}
---`;

  const message = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content[0].text;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n=== Paradise Ski Report Generator ===\n');

  const client = getClient();

  // --- Gather data ---
  console.log('[1/4] Checking Paradise road status (NPS)…');
  const roadStatus = await getParadiseRoadStatus();
  console.log(
    `      Road: ${roadStatus.open ? 'OPEN (no closure alerts found)' : 'CLOSED / RESTRICTED'}`
  );

  console.log('\n[2/4] Fetching mountain weather forecast (UW Atmos)…');
  const weatherSummary = await getWeatherSummary(client);

  console.log('\n[3/4] Fetching avalanche forecast (NWAC)…');
  const avySummary = await getAvySummary(client);

  console.log('\n[4/4] Fetching snow depth data (NRCS SNOTEL)…');
  const snowDepth = await getSnowDepth();
  if (snowDepth.snowDepthIn !== null) {
    console.log(`      Snow depth: ${snowDepth.snowDepthIn} in (${snowDepth.snowDepthChangeIn >= 0 ? '+' : ''}${snowDepth.snowDepthChangeIn} in) as of ${snowDepth.date}`);
  }

  // --- Generate report ---
  console.log('\n[5/5] Composing final report…');
  const reportBody = await generateFinalReport(client, roadStatus, weatherSummary, avySummary, snowDepth);

  // --- Format & save ---
  const now = new Date();
  const datestamp = now
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const fullReport = `# Paradise Ski Report – ${now.toDateString()}

${reportBody}

---
_Report generated: ${timestamp}_
_Sources: [NPS Conditions](${URLS.npsConditions}) · [UW Mountain Weather](${URLS.uwWeather}) · [NWAC Avalanche Forecast](${URLS.nwacAvy}) · [NRCS SNOTEL 679](${URLS.snotel})_
`;

  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const filename = `paradiseSkiReport-${datestamp}.md`;
  const filepath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(filepath, fullReport, 'utf8');

  console.log(`\nReport saved to: skiReports/${filename}`);
  console.log('=== Done ===\n');
}

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
