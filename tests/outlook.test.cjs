const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/main.js'), 'utf8');
function context(csv) {
  const ctx = vm.createContext({ document: { addEventListener() {} }, fetch: async () => ({ ok: true, text: async () => csv }), AbortController, setTimeout, clearTimeout });
  vm.runInContext(source.slice(source.indexOf('const CSV_BASE')), ctx);
  return ctx;
}
test('valid leap date is accepted and formatted currency is rejected', async () => {
  const result = await context('Report Date,Daily Close\n2024-02-29,"77,000"').fetchLatestClose();
  assert.equal(result, null); // Formatted currency is not a numeric feed value.
  assert.equal((await context('Report Date,Daily Close\n2024-02-29,77000').fetchLatestClose()).close, 77000);
});
test('impossible dates, duplicate headers and unclosed quotes fail closed', async () => {
  for (const csv of ['Report Date,Daily Close\n2026-02-29,77000', 'Report Date,Daily Close,Daily Close\n2026-09-10,77000,99999', 'Report Date,Daily Close\n2026-09-10,"77000']) {
    assert.equal(await context(csv).fetchLatestClose(), null);
  }
});
test('forecast requires exactly one of each case and a shared year', async () => {
  const valid = 'label,price,outlook_year\nBear Case,70000,2026\nBase Case,120000,2026\nBull Case,160000,2026';
  assert.equal((await context(valid).fetchOutlook()).base, 120000);
  assert.equal(await context(valid.replace('160000,2026', '160000,2027')).fetchOutlook(), null);
  assert.equal(await context(valid + '\nBear Case,80000,2026').fetchOutlook(), null);
  assert.equal(await context(valid.replace('Bull Case', 'Bear Case')).fetchOutlook(), null);
});
