# Secret Satoshis

**Bitcoin intelligence you can verify.**

This repository contains the primary Secret Satoshis website at [secretsatoshis.com](https://secretsatoshis.com/). It is a static landing page built with HTML, CSS, and vanilla JavaScript—no framework, package manager, or build step.

## What Secret Satoshis Is

Secret Satoshis is an AI-native Bitcoin market intelligence platform built from four connected layers:

1. **Market experience** — more than a decade operating across Bitcoin markets and infrastructure.
2. **Original research** — Bitcoin fundamentals, market structure, and long-term investment frameworks published since 2018.
3. **Open evidence** — market data, interactive charts, valuation models, notebooks, and open-source code.
4. **Agent 21** — an AI-native interface for exploring the complete intelligence system.

The website introduces that system and directs visitors to its live products, research, data, and newsletter.

## Current Site Structure

1. **Hero** — the core positioning: “Bitcoin intelligence you can verify.”
2. **Agent 21** — a scroll-triggered conversation demonstrating the agent's market context and current-data orientation.
3. **The Platform** — the four connected layers: experience, research, evidence, and interface.
4. **Start Here** — direct access to the Market Dashboard, Chart Library, platform guide, and investment framework.
5. **Newsletter** — the recurring market-intelligence subscription CTA.
6. **Footer** — Platform, Data, and Connect link directories.

## Project Structure

```text
Bitcoin-Secret-Satoshis/
├── index.html
├── 404.html
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

`hero-logo.jpg` is the source image. The smaller hero variants reduce page weight, while `social-card.jpg` and `favicon.png` support sharing and browser presentation.

## Technology and Design

- Semantic HTML5
- CSS custom properties, Grid, Flexbox, and responsive layouts
- Vanilla JavaScript using modern browser APIs
- Syne for display typography
- JetBrains Mono for body copy and interface details
- Bitcoin orange (`#F7931A`) as the primary accent
- GitHub Pages hosting through the custom domain in `CNAME`

The visual system is intentionally dark, technical, and evidence-led without presenting Secret Satoshis as an institutional research terminal.

## Interactive Behavior

- The Agent 21 demo begins only after the chat enters the viewport and the visitor scrolls.
- Startup status lines use the visitor's current local date; the conversation itself is a clearly staged product demonstration.
- Message typing time scales with message length.
- Orange section dividers animate as sections enter the viewport.
- The platform progress track fills with scroll position.
- The navigation collapses into an accessible mobile menu.
- Reduced-motion preferences remove simulated delays and motion effects.

## Navigation and Destinations

The primary navigation links directly to the platform's external destinations:

- Start Here
- Agent 21
- Charts
- Dashboard
- Newsletter

External destinations are introduced within their relevant sections and repeated in the footer:

- [Agent 21 on ChatGPT](https://chatgpt.com/g/g-BZXtVdU6M-agent-21)
- [Secret Satoshis Newsletter](https://newsletter.secretsatoshis.com/)
- [Market Dashboard](https://dashboard.secretsatoshis.com/)
- [Chart Library](https://charts.secretsatoshis.com/)
- [Secret Satoshis on GitHub](https://github.com/SecretSatoshis)
- [Secret Satoshis on X](https://x.com/SecretSatoshis)
- [Secret Satoshis on LinkedIn](https://www.linkedin.com/company/secretsatoshis/)
- [Trey Brunson](https://treybrunson.com/)

## Metadata and Discovery

`index.html` includes:

- A canonical URL and search-engine robots directive
- Open Graph and X summary-card metadata
- A 1200×630 social preview image
- `Organization` and `WebSite` JSON-LD structured data
- Author, referrer-policy, theme-color, favicon, and Apple touch-icon metadata

`robots.txt` points crawlers to `sitemap.xml`. The sitemap currently contains the single public homepage, and `404.html` is marked `noindex`.

## Accessibility and Security

- One `h1` followed by section-level `h2` headings and card-level `h3` headings
- A keyboard-visible skip link to the primary content
- Visible keyboard focus styles
- A labeled, keyboard-scrollable `role="log"` chat transcript
- Complete-message announcements for typewritten Agent 21 responses
- A labeled email field with `autocomplete="email"`
- Mobile menu state communicated through `aria-expanded`, `aria-controls`, and changing accessible labels
- `noopener noreferrer` on external links opened in a new tab
- A restrictive Content Security Policy for this static site

## Local Development

Serve the folder over HTTP so root-relative links and browser security behavior match production more closely:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

The site uses matching cache-version query strings for `css/style.css` and `js/main.js`. Increment both values together whenever production assets change.

## License

Licensed under the [GNU General Public License v3.0](LICENSE).

Built by [Trey Brunson](https://treybrunson.com/).

**Don't trust. Verify.**
