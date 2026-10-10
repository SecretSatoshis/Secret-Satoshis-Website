/* ═══ NAV TOGGLE ═══ */
const navToggleBtn = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');

function closeNav() {
  navLinks.classList.remove('open');
  navToggleBtn.textContent = '≡';
  navToggleBtn.setAttribute('aria-label', 'Open menu');
  navToggleBtn.setAttribute('aria-expanded', 'false');
}

function openNav() {
  navLinks.classList.add('open');
  navToggleBtn.textContent = '✕';
  navToggleBtn.setAttribute('aria-label', 'Close menu');
  navToggleBtn.setAttribute('aria-expanded', 'true');
}

if (navToggleBtn && navLinks) {
  navToggleBtn.addEventListener('click', () => {
    navLinks.classList.contains('open') ? closeNav() : openNav();
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navLinks.classList.contains('open')) {
      closeNav();
      navToggleBtn.focus();
    }
  });

  // Close when a nav link is clicked
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', closeNav);
  });

  const mobileNav = window.matchMedia('(max-width: 768px)');
  mobileNav.addEventListener('change', event => {
    if (!event.matches) closeNav();
  });
}

/* ═══ SECTION DIVIDER ANIMATION ═══ */
const dividers = document.querySelectorAll('.section-divider');
const dividerObs = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('divider-visible');
      dividerObs.unobserve(entry.target);
    }
  });
}, { threshold: 0, rootMargin: '0px 0px -80px 0px' });

dividers.forEach(el => dividerObs.observe(el));

/* ═══ NEWSLETTER LADDER RAIL ═══ */
/* The rail fills as the ladder scrolls by. It begins at the content heading's slashes,
   follows its short connector into the yearly node and tracker, then resumes at Weekly
   and finishes at Subscribe; each node lights as the fill reaches it. */
const ladder = document.getElementById('newsletterLadder');
const ladderFill = document.getElementById('ladderFill');
if (ladder && ladderFill) {
  const heading = ladder.querySelector('.ladder-heading');
  const introTrack = ladder.querySelector('.ladder-intro-track');
  const introFill = ladder.querySelector('.ladder-intro-fill');
  const rungs = ladder.querySelectorAll('.rung');
  const tracker = document.getElementById('outlookTracker');
  const box = document.querySelector('#newsletter .subscribe-box');
  const share = (value) => Math.min(1, Math.max(0, value));

  function updateLadder() {
    const rect = ladder.getBoundingClientRect();
    const scrollStart = window.innerHeight * 0.6;
    const progress = share((scrollStart - rect.top) / rect.height);
    const filledPx = rect.height * progress;
    // The visible rail starts at Weekly, below the outlook introduction.
    const railRect = ladderFill.parentElement.getBoundingClientRect();
    ladderFill.style.height = (share((scrollStart - railRect.top) / railRect.height) * 100) + '%';

    if (heading && introTrack && introFill) {
      heading.classList.toggle('is-lit', filledPx > 4);
      const introRect = introTrack.getBoundingClientRect();
      const introTop = introRect.top - rect.top;
      introFill.style.height = (share((filledPx - introTop) / introRect.height) * 100) + '%';
    }

    rungs.forEach((rung) => {
      const rungTop = rung.getBoundingClientRect().top - rect.top;
      rung.classList.toggle('is-lit', filledPx >= rungTop + 10.5);
    });

    if (tracker && !tracker.hidden) {
      const trackerTop = tracker.getBoundingClientRect().top - rect.top;
      tracker.classList.toggle('is-lit', filledPx >= trackerTop + 16);
    }

    if (box) box.classList.toggle('is-lit', progress >= 0.995);
  }

  let ticking = false;
  function requestLadderUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      updateLadder();
      ticking = false;
    });
  }

  window.addEventListener('scroll', requestLadderUpdate, { passive: true });
  window.addEventListener('resize', requestLadderUpdate);
  // The ladder changes height when the live outlook finishes loading.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(requestLadderUpdate).observe(ladder);
  }
  updateLadder();
}

/* ═══ OUTLOOK TRACKER ═══ */
/*
 * Everything the tracker renders is fetched: the three case levels, the year they
 * forecast and the daily close from the Report Library's published CSVs, and the price
 * now from BRK, which stands in for the close when it passes the checks in
 * plausibleLivePrice(). Nothing is hardcoded here. A local copy of the levels would be a second hand-maintained place
 * for the same published number, and the two would eventually disagree: the dashboard
 * and this page would then show different bull/base/bear levels for one forecast.
 *
 * The tracker fails closed. If any request fails, the levels are malformed, the files
 * do not match the release manifest's report date and SHA-256 hashes, or the outlook
 * year does not match the report date's year, the section is never revealed and
 * degrades to the ladder alone — a stale number is worse than no number on a page whose
 * claim is that the data can be checked.
 */
const CSV_BASE = 'https://secretsatoshis.github.io/Bitcoin-Report-Library/csv';
const OHLC_FILE = 'report_ohlc_summary.csv';
const OUTLOOK_FILE = 'price_outlook.csv';
const RELEASE_MANIFEST_URL = CSV_BASE + '/release_manifest.json';

/* A hung connection would otherwise leave the promise pending forever, with the tracker
 * hidden and no diagnostic. */
const FETCH_TIMEOUT_MS = 8000;

/*
 * Bitcoin's price now, from BRK, so the tracker and the Agent 21 example read as of
 * today rather than the release's last completed day. One request serves both. A
 * price that is stale, from the future, malformed or implausibly far from the
 * release's verified close is not used, and the close stands in for it.
 */
const LIVE_PRICE_URL = 'https://bitview.space/api/v1/prices';
const LIVE_PRICE_MAX_AGE_MS = 6 * 3600 * 1000;
const LIVE_PRICE_MAX_MOVE = 1.5;
let livePriceRequest = null;

function loadLivePrice() {
  if (!livePriceRequest) {
    livePriceRequest = fetchBytes(LIVE_PRICE_URL).then((bytes) => parseLivePrice(readJson(bytes), Date.now()));
  }
  return livePriceRequest;
}

/* { price, at } (at in milliseconds) from BRK's reply, or null if malformed or not recent. */
function parseLivePrice(reply, now) {
  if (!reply || !Number.isFinite(reply.USD) || reply.USD <= 0 || !Number.isFinite(reply.time)) return null;
  const at = reply.time * 1000;
  if (now - at > LIVE_PRICE_MAX_AGE_MS || at - now > 10 * 60 * 1000) return null;
  return { price: reply.USD, at };
}

/* The live price with the visitor's date for it, when it is within reach of `close`. */
function plausibleLivePrice(live, close) {
  if (!live || live.price > close * LIVE_PRICE_MAX_MOVE || live.price < close / LIVE_PRICE_MAX_MOVE) return null;
  return { price: live.price, at: live.at, date: localDate(live.at) };
}

/* "2026-10-10": the day `ms` falls on for the visitor. */
function localDate(ms) {
  return new Date(ms).toLocaleDateString('en-CA');
}

document.addEventListener('DOMContentLoaded', initOutlookTracker);

async function initOutlookTracker() {
  const root = document.getElementById('outlookTracker');
  if (!root) return;

  const livePrice = loadLivePrice();
  const [ohlcBytes, outlookBytes, manifestBytes] = await Promise.all([
    fetchBytes(CSV_BASE + '/' + OHLC_FILE),
    fetchBytes(CSV_BASE + '/' + OUTLOOK_FILE),
    fetchBytes(RELEASE_MANIFEST_URL),
  ]);
  if (!ohlcBytes || !outlookBytes) {
    console.warn('Outlook tracker hidden: the published close or outlook file could not be fetched.');
    return;
  }

  const snapshot = parseLatestClose(decodeText(ohlcBytes));
  const outlook = parseOutlook(decodeText(outlookBytes));
  if (!snapshot || !outlook) {
    console.warn(
      'Outlook tracker hidden: ' + (snapshot ? OUTLOOK_FILE : OHLC_FILE) + ' is malformed.'
    );
    return;
  }

  const { close, date } = snapshot;

  // Every file must belong to the release the manifest describes; otherwise the page
  // could pair one day's close with another release's levels.
  const consistent = await matchesReleaseManifest(manifestBytes, date, {
    [OHLC_FILE]: ohlcBytes,
    [OUTLOOK_FILE]: outlookBytes,
  });
  if (!consistent) {
    console.warn(
      'Outlook tracker hidden: the release manifest is missing or does not match the published files.'
    );
    return;
  }

  // The outlook is published once a year. If it has not been refreshed for the year the
  // report belongs to, the levels are last year's — say nothing rather than label a
  // stale forecast with the current year.
  const reportYear = Number(date.slice(0, 4));
  if (outlook.year !== reportYear) {
    console.warn(
      'Outlook tracker hidden: published outlook is for ' + outlook.year +
      ' but the report date is ' + date + '.'
    );
    return;
  }

  // The price now, when BRK's passes the checks and falls in the outlook's year (on New
  // Year's Day the year just ended is still being tracked); otherwise the close.
  const live = plausibleLivePrice(await livePrice, close);
  const now = live && Number(live.date.slice(0, 4)) === outlook.year ? live : null;
  if (!now) console.warn('Outlook tracker shows the ' + date + ' close: BRK\'s price could not be used.');
  const price = now ? now.price : close;
  const asOf = now ? now.date : date;

  const { bear, base, bull } = outlook;

  document.getElementById('outlookYear').textContent = String(outlook.year);
  document.getElementById('outlookAsOf').textContent = 'as of ' + formatAsOf(asOf);

  // Case ticks: bear anchors 0%, bull anchors 100%, base falls where it falls.
  root.querySelectorAll('.outlook-tick').forEach((tick) => {
    const value = outlook[tick.dataset.case];
    tick.style.left = pctOfRange(value, outlook) + '%';
    tick.querySelector('i span').textContent = formatUsd(value);
  });

  // Marker. Clamped into the dashed overflow zone rather than pinned at a level
  // it has not reached.
  const rawPct = pctOfRange(price, outlook);
  const pct = Math.min(108.7, Math.max(-8.7, rawPct));
  const marker = document.getElementById('outlookNow');
  marker.style.left = pct + '%';
  marker.classList.toggle('is-outside', price < bear || price > bull);
  marker.classList.toggle('align-start', pct < 6);
  marker.classList.toggle('align-end', pct > 94);

  document.getElementById('outlookPrice').textContent =
    price < bear ? '◂ ' + formatUsd(price)
    : price > bull ? formatUsd(price) + ' ▸'
    : formatUsd(price);

  document.getElementById('outlookSummary').textContent =
    (now ? 'Bitcoin price: ' : 'Bitcoin daily close: ') + formatUsd(price) + '. Bear case: ' +
    formatUsd(bear) + '. Base case: ' + formatUsd(base) + '. Bull case: ' + formatUsd(bull) + '.';

  document.getElementById('outlookRead').innerHTML = readingLine(price, asOf, outlook);
  root.hidden = false;

  // Labels can only be measured once the tracker is laid out.
  separateCrowdedLabels(root);
  let relayout = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(relayout);
    relayout = requestAnimationFrame(() => separateCrowdedLabels(root));
  });
}

/*
 * Fetch a published file's raw bytes with an explicit deadline — a pending promise would
 * hide the tracker silently. The bytes, not decoded text, are what the manifest hashes.
 * `no-cache` revalidates against the ETag on every load, so the browser cannot pair a
 * cached file from one release with a fresh manifest from the next.
 */
async function fetchBytes(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: 'no-cache', signal: controller.signal });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function decodeText(bytes) {
  return new TextDecoder().decode(bytes);
}

/*
 * The manifest is required. A missing, unreadable or mismatched manifest hides the
 * tracker, the same as a missing CSV.
 */
async function matchesReleaseManifest(manifestBytes, reportDate, files) {
  if (!manifestBytes) return false;
  let manifest;
  try {
    manifest = JSON.parse(decodeText(manifestBytes));
  } catch (err) {
    return false;
  }
  if (!manifest || typeof manifest !== 'object'
      || manifest.schema_version !== 1
      || manifest.release_id !== manifest.report_date
      || manifest.report_date !== reportDate
      || !manifest.files || typeof manifest.files !== 'object') return false;

  for (const [name, bytes] of Object.entries(files)) {
    const entry = manifest.files[name];
    if (!entry || typeof entry.sha256 !== 'string') return false;
    const digest = await sha256Hex(bytes);
    if (digest === null || digest !== entry.sha256.toLowerCase()) return false;
  }
  return true;
}

/* Null when Web Crypto is unavailable (insecure context), which fails closed. */
async function sha256Hex(bytes) {
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch (err) {
    return null;
  }
}

/*
 * Quote-aware split. The published CSVs are written by pandas, which quotes any field
 * containing a comma — price_outlook.csv's support and resistance labels such as
 * "Resistance $126,219 - 2025 ATH" among them. A naive split(',') on such a row shifts
 * every column index, so a header lookup would silently address the wrong cell and the
 * homepage would publish a wrong price.
 */
function splitCsvRow(row) {
  const cells = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i += 1) {
    const ch = row[i];
    if (inQuotes) {
      if (ch === '"') {
        if (row[i + 1] === '"') { cell += '"'; i += 1; }  // escaped quote
        else inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (inQuotes) return null;
  cells.push(cell);
  return cells.map((value) => value.trim());
}

/* Parse into objects keyed by header, refusing any row whose width disagrees with the
 * header — a mismatch means the row was misread, not that a field is missing. */
function parseCsv(text) {
  const rows = String(text).trim().split(/\r?\n/);
  if (rows.length < 2) return null;

  const header = splitCsvRow(rows[0]);
  if (!header || header.some((name) => !name) || new Set(header).size !== header.length) return null;
  const records = [];
  for (let i = 1; i < rows.length; i += 1) {
    if (!rows[i]) continue;
    const cells = splitCsvRow(rows[i]);
    if (!cells || cells.length !== header.length) return null;
    const record = Object.create(null);
    header.forEach((name, idx) => { record[name] = cells[idx]; });
    records.push(record);
  }
  return records.length ? records : null;
}

function isValidReportDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/* The summary is a single row: the latest completed daily close. */
function parseLatestClose(text) {
  const records = parseCsv(text);
  if (!records || records.length !== 1) return null;

  const row = records[0];
  const close = Number(row.daily_close);
  const date = row.date;
  if (!Number.isFinite(close) || close <= 0 || !isValidReportDate(date)) return null;
  return { close, date };
}

/*
 * The three case levels and the year they forecast. The file also carries the chart's
 * support and resistance levels, so only rows typed `case` are the forecast.
 */
function parseOutlook(text) {
  const records = parseCsv(text);
  if (!records) return null;

  const cases = records.filter((row) => row.type === 'case');
  if (cases.length !== 3) return null;
  const year = Number(cases[0].outlook_year);
  if (!Number.isInteger(year) || year < 2009 || year > 9999
      || cases.some((row) => Number(row.outlook_year) !== year)) return null;

  const levels = { bear: 'Bear Case', base: 'Base Case', bull: 'Bull Case' };
  const outlook = { year };
  for (const [key, label] of Object.entries(levels)) {
    const matches = cases.filter((row) => row.label === label);
    if (matches.length !== 1) return null;
    const price = Number(matches[0].price);
    if (!Number.isFinite(price) || price <= 0) return null;
    outlook[key] = price;
  }

  // The track maps bear→0% and bull→100%; a non-ascending set would invert it.
  if (!(outlook.bear < outlook.base && outlook.base < outlook.bull)) return null;
  return outlook;
}

/* Position on the bear→bull track, as a percentage. Uncapped; the caller clamps. */
function pctOfRange(value, { bear, bull }) {
  return ((value - bear) / (bull - bear)) * 100;
}

/*
 * Case labels are centred on their ticks, so a base case close to either end overlaps
 * that end's label on a narrow track. When two collide, each is turned to hang away
 * from the other — they then meet at most at the ticks themselves.
 */
function separateCrowdedLabels(root) {
  const ticks = {};
  root.querySelectorAll('.outlook-tick').forEach((tick) => {
    tick.classList.remove('label-start', 'label-end');
    ticks[tick.dataset.case] = tick;
  });

  const collide = (left, right) =>
    left.querySelector('i').getBoundingClientRect().right + 6 >
    right.querySelector('i').getBoundingClientRect().left;

  if (collide(ticks.bear, ticks.base)) {
    ticks.bear.classList.add('label-end');
    ticks.base.classList.add('label-start');
  } else if (collide(ticks.base, ticks.bull)) {
    ticks.base.classList.add('label-end');
    ticks.bull.classList.add('label-start');
  }
}

/*
 * Always anchors on the base case first — that is the forecast — then the
 * nearest other case. Outside the range the sentence says so plainly rather
 * than reframing the target.
 */
function readingLine(close, reportDate, { bear, base, bull }) {
  const tail = timeLeftInYear(reportDate);
  const lead = (text) => '<strong>' + text + '</strong>';

  if (close < bear) {
    return lead(relativeTo(close, bear, 'bear')) + ' — outside the published range' + tail;
  }
  if (close > bull) {
    return lead(relativeTo(close, bull, 'bull')) + ' — outside the published range' + tail;
  }
  if (close < base) {
    return lead(relativeTo(close, base, 'base')) + ', ' + relativeTo(close, bear, 'bear') + tail;
  }
  return lead(relativeTo(close, base, 'base')) + ', ' + relativeTo(close, bull, 'bull') + tail;
}

/*
 * Reads "12% above the bear case", or "at the base case" when the gap rounds to
 * nothing — which is precisely when a level is being tested, and when
 * "0% above the base case" would read as a mistake.
 */
function relativeTo(close, level, name) {
  const pct = Math.round(Math.abs(close - level) / level * 100);
  if (pct === 0) return 'at the ' + name + ' case';
  return pct + '% ' + (close < level ? 'below' : 'above') + ' the ' + name + ' case';
}

/*
 * Time remaining as of the day the tracker shows: the live price's, or the close's.
 * Deriving it from the browser clock instead would contradict the tracker on New Year's
 * Day, when the latest completed report still belongs to 31 December. Whole weeks while a week remains, then days, so the
 * last week of the year never reads as "0 weeks left".
 */
function timeLeftInYear(reportDate) {
  const days = daysLeftInYear(reportDate);
  if (days === 0) return ', on the final day of the year.';
  const [count, unit] = days < 7 ? [days, 'day'] : [Math.floor(days / 7), 'week'];
  return ', with ' + count + ' ' + unit + (count === 1 ? '' : 's') + ' left in the year.';
}

function daysLeftInYear(reportDate) {
  const [year, month, day] = String(reportDate).split('-').map(Number);
  const asOf = Date.UTC(year, month - 1, day);
  const yearEnd = Date.UTC(year, 11, 31);
  return Math.max(0, Math.round((yearEnd - asOf) / 86400000));
}

function formatUsd(value) {
  return '$' + Math.round(value).toLocaleString('en-US');
}

function formatAsOf(isoDate) {
  const parts = String(isoDate).split('-');
  if (parts.length !== 3) return isoDate;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric', month: 'short', year: 'numeric'
  }).format(d);
}

/* ═══ AGENT 21 EXAMPLE DATA ═══ */
/*
 * The figures in the homepage's Agent 21 example (js/agent21-chat.js, which calls
 * loadSinceYouLeft() and loadChain()): Bitcoin's price since Satoshi left, from the
 * Report Library's published candles, and its supply, live from BRK. Like the tracker
 * each fails closed: if a source cannot be fetched or read, or the candles do not
 * match the release manifest, the example answers without those figures.
 */
const CANDLES_FILE = 'bitcoin_candles.csv.gz';
/* Satoshi's last known email, to Mike Hearn: "I've moved on to other things." */
const SATOSHI_LEFT_ON = '2011-04-23';

async function loadSinceYouLeft() {
  const [candleBytes, manifestBytes] = await Promise.all([
    fetchBytes(CSV_BASE + '/' + CANDLES_FILE),
    fetchBytes(RELEASE_MANIFEST_URL),
  ]);
  const text = candleBytes && await gunzipText(candleBytes);
  const candles = text && parseCandles(text);
  const facts = candles && sinceYouLeft(candles, SATOSHI_LEFT_ON);
  if (!facts) {
    console.warn('Agent 21 example without figures: ' + CANDLES_FILE + ' could not be read.');
    return null;
  }
  const consistent = await matchesReleaseManifest(manifestBytes, facts.reportDate, {
    [CANDLES_FILE]: candleBytes,
  });
  if (!consistent) {
    console.warn('Agent 21 example without figures: ' + CANDLES_FILE + ' does not match the release manifest.');
    return null;
  }
  return facts;
}

/* Null where the browser cannot unzip (no DecompressionStream) or the bytes are not gzip. */
async function gunzipText(bytes) {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  } catch (err) {
    return null;
  }
}

/*
 * The daily and weekly candles, oldest first. Any malformed or out-of-order row fails
 * the whole file: a chart drawn from a misread row would show a price that never traded.
 */
function parseCandles(text) {
  const records = parseCsv(text);
  if (!records) return null;

  const series = { daily: [], weekly: [] };
  for (const row of records) {
    const list = series[row.interval];
    if (!list) continue;  // monthly
    const candle = {
      start: row.period_start,
      open: Number(row.Open),
      high: Number(row.High),
      low: Number(row.Low),
      close: Number(row.Close),
      complete: row.complete === 'True',
    };
    const { open, high, low, close } = candle;
    if (!isValidReportDate(candle.start)
        || (row.complete !== 'True' && row.complete !== 'False')
        || ![open, high, low, close].every((v) => Number.isFinite(v) && v > 0)
        || high < Math.max(open, close) || low > Math.min(open, close)) return null;
    const previous = list[list.length - 1];
    if (previous && previous.start >= candle.start) return null;
    list.push(candle);
  }
  if (series.daily.length < 2 || series.weekly.length < 2) return null;
  return series;
}

/*
 * What Agent 21 tells Satoshi: the close on the day he left and on the latest completed
 * day (the release's report date), and every weekly close for the history chart, the
 * current week to date.
 */
function sinceYouLeft({ daily, weekly }, leftOn) {
  const completed = daily.filter((c) => c.complete);
  const latest = completed[completed.length - 1];
  const left = completed.find((c) => c.start === leftOn);
  if (!latest || !left || latest.start <= leftOn) return null;

  return {
    leftOn,
    leftClose: left.close,
    reportDate: latest.start,
    close: latest.close,
    history: weekly.map(({ start, close }) => ({ start, close })),
  };
}

/*
 * The figures with BRK's price now in place of the latest close, when it passes the
 * checks: `live` and `asOf` (the visitor's date for the price) say which. The history
 * chart gains a last point at the price now.
 */
function withLivePrice(facts, livePrice) {
  const now = plausibleLivePrice(livePrice, facts.close);
  if (!now) return { ...facts, live: null, asOf: facts.reportDate };
  const history = facts.history.slice();
  if (now.date >= history[history.length - 1].start) history.push({ start: now.date, close: now.price, now: true });
  return { ...facts, close: now.price, live: now, asOf: now.date, history };
}

/*
 * The supply answer, live from BRK (the node the Report Library and the Agent 21 site
 * read): the chain tip's height and the bitcoin mined through it, and the bitcoin mined
 * by the end of the day Satoshi left. A reply that is malformed, or a mined total that
 * strays from the issuance schedule, leaves the answer out.
 */
const BRK_SERIES = 'https://bitview.space/api/series';
/* BRK numbers its daily series from this day. */
const BRK_DAY_ZERO = '2009-01-01';
const HALVING_INTERVAL = 210000;
const MAX_SUPPLY = 20999999.9769;

async function loadChain() {
  const day = Math.round((Date.parse(SATOSHI_LEFT_ON) - Date.parse(BRK_DAY_ZERO)) / 86400000);
  const [tipBytes, thenBytes] = await Promise.all([
    fetchBytes(BRK_SERIES + '/subsidy_cumulative/height?start=-1'),
    fetchBytes(BRK_SERIES + '/subsidy_cumulative/day1?start=' + day + '&end=' + (day + 1)),
  ]);
  const chain = parseChain(readJson(tipBytes), readJson(thenBytes), day);
  if (!chain) console.warn('Agent 21 example without supply: BRK could not be read.');
  return chain;
}

function readJson(bytes) {
  if (!bytes) return null;
  try {
    return JSON.parse(decodeText(bytes));
  } catch (err) {
    return null;
  }
}

/* The one value of a BRK series reply, which must be for the index and position asked. */
function seriesValue(reply, index, start) {
  if (!reply || reply.index !== index || reply.start !== start
      || !Array.isArray(reply.data) || reply.data.length !== 1) return null;
  const value = reply.data[0];
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseChain(tip, then, day) {
  const height = tip && tip.start;
  if (!Number.isInteger(height) || height <= 0) return null;
  const mined = seriesValue(tip, 'height', height);
  const minedWhenLeft = seriesValue(then, 'day1', day);
  // Miners have left a few coins unclaimed, so the mined total sits just under the schedule.
  const scheduled = scheduledSupply(height);
  if (mined === null || minedWhenLeft === null || mined > scheduled
      || scheduled - mined > 1000 || minedWhenLeft >= mined) return null;
  return {
    height,
    mined,
    minedWhenLeft,
    left: MAX_SUPPLY - mined,
    share: mined / MAX_SUPPLY,
    subsidy: blockSubsidy(height),
    nextHalving: (Math.floor(height / HALVING_INTERVAL) + 1) * HALVING_INTERVAL,
    eras: supplyEras(height),
    retrievedAt: typeof tip.stamp === 'string' ? tip.stamp : null,
  };
}

/* The reward for mining block `height`: 50 bitcoin, halved every 210,000 blocks. */
function blockSubsidy(height) {
  return 50 / 2 ** Math.floor(height / HALVING_INTERVAL);
}

/* Bitcoin issued through block `height`, block 0 included, on that schedule. */
function scheduledSupply(height) {
  let total = 0;
  for (let first = 0; first <= height; first += HALVING_INTERVAL) {
    total += (Math.min(height + 1, first + HALVING_INTERVAL) - first) * blockSubsidy(first);
  }
  return total;
}

/*
 * The 21 million in halving eras, through the current one, then everything after it as
 * one: each with its first block, reward, bitcoin issued and the running total at its end.
 */
function supplyEras(height) {
  const eras = [];
  let end = 0;
  for (let first = 0; first <= height; first += HALVING_INTERVAL) {
    const subsidy = blockSubsidy(first);
    end += HALVING_INTERVAL * subsidy;
    eras.push({ first, last: first + HALVING_INTERVAL - 1, subsidy, issued: HALVING_INTERVAL * subsidy, end });
  }
  const first = eras.length * HALVING_INTERVAL;
  eras.push({ first, last: null, subsidy: blockSubsidy(first), issued: MAX_SUPPLY - end, end: MAX_SUPPLY });
  return eras;
}
