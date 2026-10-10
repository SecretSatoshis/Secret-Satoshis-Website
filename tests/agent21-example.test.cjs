const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { gzipSync } = require('node:zlib');
const { createHash, webcrypto } = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/main.js'), 'utf8');
function context(globals = {}) {
  const ctx = vm.createContext({
    document: { addEventListener() {} }, crypto: webcrypto, TextDecoder, AbortController, setTimeout, clearTimeout,
    Blob, Response, DecompressionStream, console: { warn() {} }, ...globals,
  });
  vm.runInContext(source.slice(source.indexOf('const CSV_BASE')), ctx);
  return ctx;
}

// The published file's shape: daily, weekly and monthly candles, oldest first.
const HEADER = 'interval,period_start,period_end,observation_date,complete,Open,High,Low,Close';
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86400000;
function candles({ weeks = 60, last = '2026-10-08' } = {}) {
  const rows = [HEADER];
  const daily = [['2011-04-22', 1.23, 1.29, 1.23, 1.29], ['2011-04-23', 1.42, 1.55, 1.42, 1.55], ['2025-10-06', 120000, 125651.43, 119000, 124000], [last, 83189.77, 83208.33, 80567.81, 81649.5]];
  for (const [d, o, h, l, c] of daily) rows.push(`daily,${d},${d},${d},True,${o},${h},${l},${c}`);
  const lastWeek = Date.parse(last) - ((new Date(last).getUTCDay() + 6) % 7) * DAY;
  for (let i = weeks - 1; i >= 0; i--) {
    const start = iso(lastWeek - i * 7 * DAY);
    const close = i === 0 ? 81649.5 : 60000 + i * 500;
    rows.push(`weekly,${start},${iso(Date.parse(start) + 6 * DAY)},${i === 0 ? last : iso(Date.parse(start) + 6 * DAY)},${i === 0 ? 'False' : 'True'},${close},${close * 1.05},${close * 0.95},${close}`);
  }
  rows.push('monthly,2026-09-01,2026-09-30,2026-09-30,True,80000,90000,70000,85000');
  return rows.join('\n');
}

test('candles are read in order and any malformed row fails the file', () => {
  const ctx = context();
  const parsed = ctx.parseCandles(candles());
  assert.equal(parsed.daily.length, 4);
  assert.equal(parsed.weekly.length, 60);
  assert.equal(parsed.weekly.at(-1).complete, false);
  const daily = 'daily,2011-04-23,2011-04-23,2011-04-23,True,1.42,1.55,1.42,1.55';
  for (const bad of [
    daily.replace(',1.42,1.55,1.42,1.55', ',1.42,1.5,1.42,1.55'),  // high under the close
    daily.replace('True', 'yes'),
    daily.replace('2011-04-23,2011', '2011-02-30,2011'),
    daily.replace(',1.42,1.55,1.42,1.55', ',1.42,1.55,1.42,"1,55"'),
  ]) {
    assert.equal(ctx.parseCandles(candles().replace(daily, bad)), null, bad);
  }
  // Out of order.
  assert.equal(ctx.parseCandles(candles().replace('2011-04-22', '2011-04-24')), null);
});

test('since-you-left figures come from the day he left and the latest completed day', () => {
  const ctx = context();
  const facts = ctx.sinceYouLeft(ctx.parseCandles(candles()), vm.runInContext('SATOSHI_LEFT_ON', ctx));
  assert.equal(facts.leftClose, 1.55);
  assert.equal(facts.reportDate, '2026-10-08');
  assert.equal(facts.close, 81649.5);
  assert.equal(facts.history.length, 60);
  // No close for the day he left: no figures.
  assert.equal(ctx.sinceYouLeft(ctx.parseCandles(candles()), '2011-04-24'), null);
});

test('the example loads the gzipped candles only when they match the release manifest', async () => {
  const gz = gzipSync(candles());
  const manifest = (sha256) => JSON.stringify({
    schema_version: 1, release_id: '2026-10-08', report_date: '2026-10-08',
    files: { 'bitcoin_candles.csv.gz': { sha256 } },
  });
  const fetchFrom = (files) => async (url) => {
    const body = files[url.split('/').pop()];
    return body === undefined ? { ok: false } : { ok: true, arrayBuffer: async () => new Uint8Array(Buffer.from(body)).buffer };
  };
  const good = createHash('sha256').update(gz).digest('hex');
  const ok = context({ fetch: fetchFrom({ 'bitcoin_candles.csv.gz': gz, 'release_manifest.json': manifest(good) }) });
  assert.equal((await ok.loadSinceYouLeft()).close, 81649.5);
  const stale = context({ fetch: fetchFrom({ 'bitcoin_candles.csv.gz': gz, 'release_manifest.json': manifest('0'.repeat(64)) }) });
  assert.equal(await stale.loadSinceYouLeft(), null);
  const missing = context({ fetch: fetchFrom({ 'release_manifest.json': manifest(good) }) });
  assert.equal(await missing.loadSinceYouLeft(), null);
  const notGzip = context({ fetch: fetchFrom({ 'bitcoin_candles.csv.gz': candles(), 'release_manifest.json': manifest(good) }) });
  assert.equal(await notGzip.loadSinceYouLeft(), null);
});

// BRK series replies: the chain tip by height, and the day Satoshi left by day.
const tip = (mined, height = 970695) => ({ version: 28, index: 'height', type: 'Bitcoin', start: height, end: height + 1, stamp: '2026-10-10T00:06:04Z', data: [mined] });
const then = (mined, start = 842) => ({ version: 53, index: 'day1', type: 'Bitcoin', start, end: start + 1, stamp: '2026-10-10T00:07:04Z', data: [mined] });

test('the issuance schedule halves every 210,000 blocks and stops short of 21 million', () => {
  const ctx = context();
  assert.equal(ctx.blockSubsidy(0), 50);
  assert.equal(ctx.blockSubsidy(970695), 3.125);
  assert.equal(ctx.scheduledSupply(209999), 10500000);
  assert.equal(ctx.scheduledSupply(839999), 19687500);
  assert.equal(ctx.scheduledSupply(970695), 20095925);
  const eras = ctx.supplyEras(970695);
  assert.deepEqual(Array.from(eras, (e) => e.subsidy), [50, 25, 12.5, 6.25, 3.125, 1.5625]);
  assert.equal(eras.at(-1).last, null);
  assert.equal(eras.at(-1).end, 20999999.9769);
  assert.ok(Math.abs(eras.reduce((sum, e) => sum + e.issued, 0) - 20999999.9769) < 1e-6);
});

test('the chain tip is read from BRK and checked against the schedule', () => {
  const ctx = context();
  const chain = ctx.parseChain(tip(20095896.04), then(5992100), 842);
  assert.equal(chain.height, 970695);
  assert.equal(chain.nextHalving, 1050000);
  assert.equal(chain.subsidy, 3.125);
  assert.equal(Math.round(chain.left), 904104);
  assert.equal(chain.retrievedAt, '2026-10-10T00:06:04Z');
  for (const [label, a, b] of [
    ['more than the schedule allows', tip(20095926), then(5992100)],
    ['far short of the schedule', tip(20090000), then(5992100)],
    ['another series', { ...tip(20095896.04), index: 'day1' }, then(5992100)],
    ['another day', tip(20095896.04), then(5992100, 841)],
    ['two values', { ...tip(20095896.04), data: [1, 2] }, then(5992100)],
    ['no height', { ...tip(20095896.04), start: 'tip' }, then(5992100)],
    ['no reply', null, then(5992100)],
  ]) {
    assert.equal(ctx.parseChain(a, b, 842), null, label);
  }
});

test('the example asks BRK for the tip and for the day Satoshi left', async () => {
  const asked = [];
  const ctx = context({
    fetch: async (url) => {
      asked.push(url);
      const reply = url.includes('/height?') ? tip(20095896.04) : then(5992100);
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(reply)).buffer };
    },
  });
  assert.equal((await ctx.loadChain()).height, 970695);
  assert.deepEqual(asked.sort(), [
    'https://bitview.space/api/series/subsidy_cumulative/day1?start=842&end=843',
    'https://bitview.space/api/series/subsidy_cumulative/height?start=-1',
  ]);
  const down = context({ fetch: async () => ({ ok: false }) });
  assert.equal(await down.loadChain(), null);
});
