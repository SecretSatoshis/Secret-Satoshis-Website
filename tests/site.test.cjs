const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PAGES = ['index.html', '404.html', 'privacy.html'];
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
// Local files a page loads, with the leading "/" of root-relative paths removed.
const localRefs = (html) => [...html.matchAll(/(?:href|src)="(\/?(?:css|js|assets)\/[^"?#]+)(\?v=\d+)?"/g)]
  .map(([, ref, version]) => ({ file: ref.replace(/^\//, ''), version: version || '' }));

test('every local file a page or the font stylesheet references exists', () => {
  for (const page of PAGES) {
    for (const { file } of localRefs(read(page))) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${page} references missing ${file}`);
    }
  }
  const fontUrls = [...read('css/fonts.css').matchAll(/url\(([^)]+)\)/g)].map(([, url]) => url);
  assert.ok(fontUrls.length > 0);
  for (const url of fontUrls) {
    assert.ok(fs.existsSync(path.join(ROOT, 'css', url)), `css/fonts.css references missing ${url}`);
  }
});

test('pages share one cache version per asset, so a release reaches every page', () => {
  const versions = {};
  for (const page of PAGES) {
    for (const { file, version } of localRefs(read(page))) {
      if (!version) continue;
      versions[file] ??= new Set();
      versions[file].add(version);
    }
  }
  for (const [file, seen] of Object.entries(versions)) {
    assert.equal(seen.size, 1, `${file} is loaded with different versions: ${[...seen].join(', ')}`);
  }
});

test('no page loads fonts or styles from a third-party service', () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/, page);
    assert.match(html, /style-src 'self';/, page);
    assert.match(html, /font-src 'self';/, page);
  }
});
