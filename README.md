# Secret Satoshis

**Bitcoin research and intelligence — AI-native analysis grounded in open research and a decade operating within Bitcoin markets.**

This repository contains the official Secret Satoshis landing page and website, built with vanilla HTML, CSS, and JavaScript. No frameworks. No dependencies. Just clean, performant code.

🌐 **Live Site:** [secretsatoshis.com](https://secretsatoshis.com)

---

## About Secret Satoshis

Secret Satoshis is a Bitcoin research and education platform that combines:
- **Human Experience** — A decade of first-hand experience across Bitcoin markets and infrastructure
- **Bitcoin Foundation** — Foundational research spanning fundamentals, market structure, and long-term capital frameworks
- **Open Source** — Code, research frameworks, and data models developed openly for transparency and verification
- **AI Intelligence** — Agent 21, an AI agent trained on the Secret Satoshis framework for structured Bitcoin analysis

---

## Project Overview

This is the **main landing page** for Secret Satoshis, designed to:
- Introduce visitors to the Secret Satoshis platform and philosophy
- Provide access to Agent 21 (AI-powered Bitcoin intelligence)
- Showcase the four-layer architecture (Human Experience → Foundation → Open Source → AI)
- Drive engagement through newsletter subscription and educational resources
- Direct users to key resources and the Secret Satoshis ecosystem

---

## Technology Stack

### Core Technologies
- **HTML5** — Semantic markup with proper accessibility (ARIA labels, keyboard navigation)
- **CSS3** — Modern CSS with custom properties, flexbox, grid, and responsive design
- **Vanilla JavaScript** — Zero dependencies, pure ES6+ JavaScript

### Design Principles
- **Zero Dependencies** — No frameworks, no libraries, no build tools required
- **Performance First** — Total bundle size ~88KB (HTML + CSS + JS + assets)
- **Accessibility** — WCAG AA compliant, keyboard navigable, screen reader friendly
- **Mobile-First Responsive** — Fully responsive across all devices
- **SEO Optimized** — Proper meta tags, OG tags, semantic HTML structure

### Typography
- **Display Font:** Syne (Google Fonts) — Headers and titles
- **Code Font:** JetBrains Mono (Google Fonts) — Body text and technical content

### Color Palette
- **Bitcoin Orange:** `#F7931A` — Accent color
- **Dark Background:** `#0A0A0A` — Primary background
- **Light Text:** `#FAFAFA` — Primary text
- **Muted Text:** `#707070` / `#999999` — Secondary text

---

## Features

### Interactive Elements
- **Typewriter Animations** — Dynamic text reveals throughout the site
- **Agent 21 Chat Demo** — Interactive chat simulation with pre-programmed Q&A
- **Scroll-Triggered Reveals** — Content fades in as user scrolls (using IntersectionObserver)
- **Responsive Navigation** — Mobile hamburger menu with smooth transitions
- **Platform Layers** — Four-layer architecture visualization with hover states

### Content Sections
1. **Hero Section** — Main headline with trust badges and branding
2. **Agent 21** — Interactive chat demo showcasing AI capabilities
3. **Platform Architecture** — Four-layer framework explanation (Layers 0-3)
4. **Get Started** — Educational resources and article links
5. **Newsletter Subscription** — Email capture for Substack integration
6. **Footer** — Links, Genesis Block quote, and branding

---

## Project Structure

```
Bitcoin-Secret-Satoshis/
├── index.html              # Main HTML file (261 lines)
├── css/
│   └── style.css          # All styles (1190 lines, 24KB)
├── js/
│   └── main.js            # All JavaScript (317 lines, 12KB)
├── assets/
│   └── images/
│       └── hero-logo.jpg  # Secret Satoshis logo (36KB)
├── .gitignore             # Git ignore rules
├── LICENSE                # GNU GPL v3.0
└── README.md              # This file
```

## Code Architecture

### HTML Structure
- Semantic HTML5 with proper document structure
- External links include `rel="noopener noreferrer"` for security
- Meta tags for SEO and social sharing (OG tags)
- Single-page application (SPA) design
- Mobile-first viewport configuration

### CSS Organization
```css
/* CSS is organized into clear sections: */
1. CSS Variables & Reset
2. Base Typography & Layout
3. Navigation
4. Hero Section
5. Agent 21 Section (Chat Demo)
6. Platform/Protocol Section (4 Layers)
7. Education Section
8. Subscribe Section
9. Footer
10. Responsive Media Queries
```

### JavaScript Modules
```javascript
// main.js contains modular functions:
- Navigation toggle (mobile menu)
- Typewriter animations (multiple instances)
- Agent 21 chat simulation
- Scroll-triggered reveals (IntersectionObserver)
- Accessibility features (keyboard support, reduced motion)
```

---

## Key Components

### 1. Typewriter Effect
Dynamic typing animation used in:
- Navigation logo
- Hero section label
- Section labels throughout site

### 2. Agent 21 Chat Demo
Interactive chat simulation featuring:
- Greeting message with typewriter effect
- Four pre-programmed question buttons
- Animated responses with link CTAs
- "Continue on ChatGPT" integration

### 3. Platform Layers
Four-layer architecture visualization:
- **Layer 0:** Human Experience
- **Layer 1:** Bitcoin Foundation
- **Layer 2:** Open Source
- **Layer 3:** AI Intelligence

Each layer includes hover effects and external links.

### 4. Scroll Reveals
Smooth fade-in animations triggered by scroll position using IntersectionObserver API for optimal performance.

---

## External Integrations

### Links & Resources
- **Newsletter:** [newsletter.secretsatoshis.com](https://newsletter.secretsatoshis.com/)
- **Agent 21 (ChatGPT):** [ChatGPT Agent 21](https://chatgpt.com/g/g-BZXtVdU6M-agent-21)
- **GitHub:** [github.com/SecretSatoshis](https://github.com/SecretSatoshis)
- **Twitter/X:** [@SecretSatoshis](https://x.com/SecretSatoshis)
- **Personal Site:** [treybrunson.com](https://treybrunson.com)

### Newsletter Integration
Email subscription form submits to Substack:
```html
<form action="https://newsletter.secretsatoshis.com/subscribe" method="get">
```

---

## License

This project is licensed under the **GNU General Public License v3.0**.

See [LICENSE](LICENSE) file for details.

---

## Contact & Community

- **Newsletter:** [Subscribe for updates](https://newsletter.secretsatoshis.com/subscribe)
- **Twitter/X:** [@SecretSatoshis](https://x.com/SecretSatoshis)
- **GitHub:** [SecretSatoshis](https://github.com/SecretSatoshis)
- **Agent 21:** [Chat on ChatGPT](https://chatgpt.com/g/g-BZXtVdU6M-agent-21)

---

## Acknowledgments

**Built by:** [Trey Brunson](https://treybrunson.com)

**Don't trust. Verify.**

₿ // SECRET SATOSHIS