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
├── css/
│   └── style.css
├── js/
│   └── main.js
├── assets/
│   └── images/
│       ├── hero-logo.jpg
│       ├── hero-logo-840.jpg
│       ├── hero-logo-420.jpg
│       ├── social-card.jpg
│       └── favicon.png
├── CNAME
├── robots.txt
├── sitemap.xml
├── LICENSE
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

## Local Development

Serve the folder over HTTP so root-relative links and browser security behavior match production more closely:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

The site uses cache-version query strings for `css/style.css` and `js/main.js`.
Increment the version for the asset that changed and update that asset's reference on
`index.html`, `404.html`, and `privacy.html` so every page receives the same production
file.

## Privacy

The public privacy notice is served at
[`https://secretsatoshis.com/privacy.html`](https://secretsatoshis.com/privacy.html).
The static site does not operate accounts, analytics, advertising trackers, or its own
email database. Newsletter subscriptions are submitted directly to Substack.

## License

Licensed under the [GNU General Public License v3.0](LICENSE).
