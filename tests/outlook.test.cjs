const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/main.js'), 'utf8');
function context() {
  const ctx = vm.createContext({ document: { addEventListener() {} }, crypto: webcrypto, TextDecoder, AbortController, setTimeout, clearTimeout });
  vm.runInContext(source.slice(source.indexOf('const CSV_BASE')), ctx);
  return ctx;
}
const bytes = (text) => new TextEncoder().encode(text).buffer;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// Shape of the live price_outlook.csv: three cases plus the chart's support and resistance rows.
const OUTLOOK = [
  'label,price,type,color,outlook_year',
  'Bull Case,160000,case,#00FF88,2026',
  'Base Case,120000,case,#FFD700,2026',
  'Bear Case,70000,case,#FF3B30,2026',
  '"Resistance $126,219 - 2025 ATH",126219,resistance,#9ca3af,2026',
  '"Support $60,132 - 2026 Low",60132,support,#9ca3af,2026',
].join('\n');
const OHLC = 'date,daily_close\n2026-09-27,84146.38';

test('valid leap date is accepted and formatted currency is rejected', () => {
  const ctx = context();
  assert.equal(ctx.parseLatestClose('date,daily_close\n2024-02-29,"77,000"'), null); // Formatted currency is not a numeric feed value.
  assert.equal(ctx.parseLatestClose('date,daily_close\n2024-02-29,77000').close, 77000);
});
test('impossible dates, duplicate headers, unclosed quotes and extra rows fail closed', () => {
  const ctx = context();
  for (const csv of ['date,daily_close\n2026-02-29,77000', 'date,daily_close,daily_close\n2026-09-10,77000,99999', 'date,daily_close\n2026-09-10,"77000', 'date,daily_close\n2026-09-10,77000\n2026-09-09,76000']) {
    assert.equal(ctx.parseLatestClose(csv), null);
  }
});
test('forecast reads the case rows from the published file and requires one of each in a shared year', () => {
  const ctx = context();
  const outlook = ctx.parseOutlook(OUTLOOK);
  assert.deepEqual({ ...outlook }, { year: 2026, bear: 70000, base: 120000, bull: 160000 });
  assert.equal(ctx.parseOutlook(OUTLOOK.replace('160000,case,#00FF88,2026', '160000,case,#00FF88,2027')), null);
  assert.equal(ctx.parseOutlook(OUTLOOK + '\nBear Case,80000,case,#FF3B30,2026'), null);
  assert.equal(ctx.parseOutlook(OUTLOOK.replace('Bull Case', 'Bear Case')), null);
  // A support or resistance row that shares a case name is not a case.
  assert.equal(ctx.parseOutlook(OUTLOOK + '\nBear Case,50000,support,#9ca3af,2026').bear, 70000);
});
test('release manifest is required and must match the report date and file hashes', async () => {
  const ctx = context();
  const manifest = (overrides = {}) => bytes(JSON.stringify({
    schema_version: 1, release_id: '2026-09-27', report_date: '2026-09-27',
    files: { 'report_ohlc_summary.csv': { sha256: sha256(OHLC) }, 'price_outlook.csv': { sha256: sha256(OUTLOOK) } },
    ...overrides,
  }));
  const files = { 'report_ohlc_summary.csv': bytes(OHLC), 'price_outlook.csv': bytes(OUTLOOK) };
  assert.equal(await ctx.matchesReleaseManifest(manifest(), '2026-09-27', files), true);
  assert.equal(await ctx.matchesReleaseManifest(null, '2026-09-27', files), false);
  assert.equal(await ctx.matchesReleaseManifest(bytes('{"schema_version":'), '2026-09-27', files), false);
  assert.equal(await ctx.matchesReleaseManifest(manifest(), '2026-09-26', files), false);
  const stale = { ...files, 'price_outlook.csv': bytes(OUTLOOK.replace('120000', '110000')) };
  assert.equal(await ctx.matchesReleaseManifest(manifest(), '2026-09-27', stale), false);
});
test('time left in the year switches to days in the final week', () => {
  const ctx = context();
  assert.equal(ctx.timeLeftInYear('2026-09-27'), ', with 13 weeks left in the year.');
  assert.equal(ctx.timeLeftInYear('2026-12-24'), ', with 1 week left in the year.');
  assert.equal(ctx.timeLeftInYear('2026-12-28'), ', with 3 days left in the year.');
  assert.equal(ctx.timeLeftInYear('2026-12-30'), ', with 1 day left in the year.');
  assert.equal(ctx.timeLeftInYear('2026-12-31'), ', on the final day of the year.');
});

// BRK's price reply: { time (seconds), USD }.
const NOW = Date.parse('2026-09-28T12:00:00Z');
class FixedDate extends Date {
  static now() { return NOW; }
}
test('the live price must be recent and well formed, and near the verified close', () => {
  const ctx = context();
  const at = NOW - 5 * 60 * 1000;
  assert.deepEqual({ ...ctx.parseLivePrice({ time: at / 1000, USD: 90000 }, NOW) }, { price: 90000, at });
  assert.equal(ctx.parseLivePrice({ time: (NOW - 7 * 3600 * 1000) / 1000, USD: 90000 }, NOW), null); // Stale.
  assert.equal(ctx.parseLivePrice({ time: (NOW + 20 * 60 * 1000) / 1000, USD: 90000 }, NOW), null); // From the future.
  for (const reply of [null, { time: at / 1000, USD: '90000' }, { USD: 90000 }, { time: at / 1000, USD: -1 }]) {
    assert.equal(ctx.parseLivePrice(reply, NOW), null);
  }
  assert.equal(ctx.plausibleLivePrice({ price: 90000, at }, 84146).price, 90000);
  assert.equal(ctx.plausibleLivePrice({ price: 200000, at }, 84146), null);
  assert.equal(ctx.plausibleLivePrice({ price: 40000, at }, 84146), null);
  assert.equal(ctx.plausibleLivePrice(null, 84146), null);
});

// The tracker against a stand-in page: just the elements it fills.
async function track(priceReply) {
  const element = (extra = {}) => {
    const classes = new Set();
    return {
      textContent: '', innerHTML: '', hidden: true, style: {}, dataset: {},
      classList: {
        toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
      },
      getBoundingClientRect: () => ({ left: 0, right: 0 }),
      ...extra,
    };
  };
  const ticks = ['bear', 'base', 'bull'].map((name) => {
    const span = element();
    const i = element();
    return element({ dataset: { case: name }, querySelector: (q) => (q === 'i span' ? span : i) });
  });
  const ids = {
    outlookTracker: element({ querySelectorAll: () => ticks }),
    outlookYear: element(), outlookAsOf: element(), outlookNow: element(),
    outlookPrice: element(), outlookSummary: element(), outlookRead: element(),
  };
  const manifest = JSON.stringify({
    schema_version: 1, release_id: '2026-09-27', report_date: '2026-09-27',
    files: { 'report_ohlc_summary.csv': { sha256: sha256(OHLC) }, 'price_outlook.csv': { sha256: sha256(OUTLOOK) } },
  });
  const files = { 'report_ohlc_summary.csv': OHLC, 'price_outlook.csv': OUTLOOK, 'release_manifest.json': manifest, prices: priceReply && JSON.stringify(priceReply) };
  const ctx = vm.createContext({
    document: { addEventListener() {}, getElementById: (id) => ids[id] },
    window: { addEventListener() {} },
    fetch: async (url) => {
      const body = files[url.split('/').pop()];
      return body == null ? { ok: false } : { ok: true, arrayBuffer: async () => bytes(body) };
    },
    Date: FixedDate, crypto: webcrypto, TextDecoder, AbortController, setTimeout, clearTimeout, console: { warn() {} },
  });
  vm.runInContext(source.slice(source.indexOf('const CSV_BASE')), ctx);
  await ctx.initOutlookTracker();
  return {
    shown: !ids.outlookTracker.hidden, asOf: ids.outlookAsOf.textContent, price: ids.outlookPrice.textContent,
    summary: ids.outlookSummary.textContent, read: ids.outlookRead.innerHTML,
  };
}

test('the tracker shows BRK\'s price as of its day, and the verified close when BRK\'s price is unusable', async () => {
  const live = await track({ time: (NOW - 5 * 60 * 1000) / 1000, USD: 90000 });
  assert.equal(live.shown, true);
  assert.equal(live.asOf, 'as of Sep 28, 2026');
  assert.equal(live.price, '$90,000');
  assert.match(live.summary, /^Bitcoin price: \$90,000\. /);
  assert.equal(live.read, '<strong>25% below the base case</strong>, 29% above the bear case, with 13 weeks left in the year.');
  for (const reply of [null, { time: (NOW - 5 * 60 * 1000) / 1000, USD: 200000 }]) {
    const close = await track(reply);
    assert.equal(close.shown, true);
    assert.equal(close.asOf, 'as of Sep 27, 2026');
    assert.equal(close.price, '$84,146');
    assert.match(close.summary, /^Bitcoin daily close: \$84,146\. /);
  }
});
