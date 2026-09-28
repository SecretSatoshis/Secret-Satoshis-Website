# Secret Satoshis

**Bitcoin intelligence you can verify.**

This repository contains the primary Secret Satoshis website at [secretsatoshis.com](https://secretsatoshis.com/).

## What Secret Satoshis Is

Secret Satoshis is an AI-native Bitcoin market intelligence platform built from four connected layers:

1. **Market experience** — more than a decade operating across Bitcoin markets and infrastructure.
2. **Original research** — Bitcoin fundamentals, market structure, and long-term investment frameworks published since 2018.
3. **Open evidence** — market data, interactive charts, valuation models, notebooks, and open-source code.
4. **Agent 21** — an AI-native interface for exploring the complete intelligence system.

The website introduces that system and directs visitors to its live products, research, data, and newsletter.

## Project Structure

```text
Bitcoin-Secret-Satoshis/
├── index.html
├── 404.html
├── privacy.html
├── favicon.ico
├── llms.txt
├── css/
│   └── style.css
├── js/
│   └── main.js
├── assets/
│   └── images/
│       ├── hero-logo.jpg      # legacy full-size mark; no page references it
│       ├── hero-logo-840.jpg
│       ├── hero-logo-420.jpg
│       ├── social-card.jpg
│       └── favicon.png
├── tests/
│   └── outlook.test.cjs
├── CNAME
├── robots.txt
├── sitemap.xml
├── LICENSE
├── SECURITY.md
└── README.md
```

## Technology and Design

- Semantic HTML5
- CSS custom properties, Grid, Flexbox, and responsive layouts
- Vanilla JavaScript using modern browser APIs
- Syne for display typography
- JetBrains Mono for body copy and interface details
- Bitcoin orange (`#F7931A`) as the primary accent
- GitHub Pages hosting through the custom domain in `CNAME`

## Outlook Tracker

The newsletter section shows where Bitcoin's latest daily close sits against the
year's published bear, base, and bull cases. Nothing in it is hardcoded: `js/main.js`
reads three files from the
[Report Library's published release](https://secretsatoshis.github.io/Bitcoin-Report-Library/csv/):

- `report_ohlc_summary.csv` — the latest daily close and its report date
- `price_outlook.csv` — the case levels (rows typed `case`) and the year they forecast
- `release_manifest.json` — the release's report date and the SHA-256 hash of each file

The tracker fails closed. It stays hidden, leaving the rest of the section intact, if
any file cannot be fetched, the case levels are malformed, the files' hashes or report
date do not match the manifest, or the outlook year differs from the report date's year.
A hidden tracker logs the reason to the browser console.

The page's Content-Security-Policy allows `connect-src https://secretsatoshis.github.io`
for these requests; keep that in step if the data moves.

## Local Development

Serve the folder over HTTP so root-relative links and browser security behavior match production more closely:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). The outlook tracker fetches
the live published release, so it works locally with a network connection.

The site uses cache-version query strings for `css/style.css` and `js/main.js`.
Increment the version for the asset that changed and update that asset's reference on
`index.html`, `404.html`, and `privacy.html` so every page receives the same production
file.

## Tests

The outlook tracker's parsing and release checks are covered by Node's built-in test
runner, with no dependencies to install:

```bash
node --test tests/
```

## License

Licensed under the [GNU General Public License v3.0](LICENSE).
