const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/analytics.js'), 'utf8');

function run(url, previous = '') {
  const scripts = [];
  const context = vm.createContext({
    location: new URL(url), window: {}, URL, URLSearchParams,
    document: {
      title: 'Public page', referrer: previous,
      createElement: () => ({}), head: { appendChild: (script) => scripts.push(script) },
    },
  });
  vm.runInContext(source, context);
  return { context, scripts, commands: () => JSON.parse(JSON.stringify(context.window.dataLayer || [])) };
}

test('one production Google tag uses the supplied ID; local previews and exports never collect', () => {
  for (const url of ['http://localhost:3001/', 'http://127.0.0.1:5173/', 'file:///tmp/Bitcoin_Price.html', 'https://unrelated.example/']) {
    assert.equal(run(url).scripts.length, 0);
  }
  for (const host of ['secretsatoshis.com', 'charts.secretsatoshis.com', 'dashboard.secretsatoshis.com']) {
    const result = run(`https://${host}/`);
    assert.equal(result.scripts[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-9GQYJPLLC8');
    vm.runInContext(source, result.context);
    assert.equal(result.scripts.length, 1);
    assert.equal(result.commands().filter((command) => command[0] === 'config').length, 1);
  }
});

test('page metadata retains campaign attribution but removes emails, tokens, fragments and private referrer paths', () => {
  const result = run('https://charts.secretsatoshis.com/Bitcoin_Price.html?email=reader%40example.com&token=secret&utm_source=x&utm_medium=social#private', 'https://agent21.secretsatoshis.com/c/private-id?token=secret');
  const config = result.commands().find((command) => command[0] === 'config')[2];
  assert.equal(config.page_location, 'https://charts.secretsatoshis.com/Bitcoin_Price.html?utm_source=x&utm_medium=social');
  assert.equal(config.page_referrer, 'https://agent21.secretsatoshis.com/');
  assert.equal(config.allow_google_signals, false);
  assert.equal(config.allow_ad_personalization_signals, false);
});

test('Agent 21 app documents never load Google; isolated frames report only approved public URLs', () => {
  for (const pathname of ['/', '/waitlist', '/c/private-id', '/sign-in', '/analytics.html']) {
    assert.equal(run('https://agent21.secretsatoshis.com' + pathname).scripts.length, 0);
  }
  for (const pathname of ['/', '/waitlist']) {
    const params = new URLSearchParams({ host: 'agent21.secretsatoshis.com', path: pathname, referrer: 'https://newsletter.secretsatoshis.com/p/start-here?email=reader@example.com', utm_source: 'newsletter' });
    const result = run('https://secretsatoshis.com/analytics.html#' + params);
    const config = result.commands().find((command) => command[0] === 'config')[2];
    assert.equal(config.page_location, 'https://agent21.secretsatoshis.com' + pathname + '?utm_source=newsletter');
    assert.equal(config.page_referrer, 'https://newsletter.secretsatoshis.com/p/start-here');
  }
  for (const hash of ['', 'host=agent21.secretsatoshis.com&path=/c/private-id', 'host=unrelated.example&path=/']) {
    assert.equal(run('https://secretsatoshis.com/analytics.html#' + hash).scripts.length, 0);
  }
});
