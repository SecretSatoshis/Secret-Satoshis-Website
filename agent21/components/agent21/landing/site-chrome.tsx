"use client";

import { useEffect, useState } from "react";
// The secretsatoshis.com header and footer (index.html), so the landing page
// sits inside the main site.
const SITE = "https://secretsatoshis.com";
const NEWSLETTER = "https://newsletter.secretsatoshis.com";
const AGENT21 = "https://agent21.secretsatoshis.com/";

const NAV: [label: string, href: string, external: boolean][] = [
  ["Start Here", `${NEWSLETTER}/p/start-here`, true],
  ["Agent 21", AGENT21, false],
  ["Newsletter", `${NEWSLETTER}/`, true],
  ["Charts", "https://charts.secretsatoshis.com/", false],
  ["Dashboard", "https://dashboard.secretsatoshis.com/", false],
];

const newTab = { target: "_blank", rel: "noopener noreferrer" };

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <nav className="ss-nav" aria-label="Primary navigation">
      <a
        href={`${SITE}/`}
        className="ss-logo"
        aria-label="Secret Satoshis home"
      >
        <span className="acc">{"//"}</span> SECRET SATOSHIS
      </a>
      <button
        type="button"
        className="ss-nav-toggle"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="ss-nav-links"
        onClick={() => setOpen(!open)}
      >
        {open ? "✕" : "≡"}
      </button>
      <ul className={`ss-nav-links${open ? " open" : ""}`} id="ss-nav-links">
        {NAV.map(([label, href, external]) => (
          <li key={label}>
            <a
              href={href}
              {...(external ? newTab : {})}
              aria-current={href === AGENT21 ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const FOOTER: [title: string, links: [string, string, boolean][]][] = [
  [
    "Platform",
    [
      ["Start Here", `${NEWSLETTER}/p/start-here`, true],
      ["Agent 21", AGENT21, false],
      ["Newsletter", `${NEWSLETTER}/`, true],
    ],
  ],
  [
    "Data",
    [
      ["Market Dashboard", "https://dashboard.secretsatoshis.com/", false],
      ["Chart Library", "https://charts.secretsatoshis.com/", false],
      ["GitHub", "https://github.com/SecretSatoshis", true],
    ],
  ],
  [
    "Connect",
    [
      ["𝕏 @SecretSatoshis", "https://x.com/SecretSatoshis", true],
      ["LinkedIn", "https://www.linkedin.com/company/secretsatoshis/", true],
      ["TreyBrunson.com", "https://treybrunson.com/", true],
    ],
  ],
];

export function SiteFooter() {
  return (
    <footer className="ss-footer">
      <div className="ss-footer-inner">
        <div className="ss-footer-top">
          <div>
            <a
              href={`${SITE}/`}
              className="ss-logo"
              aria-label="Secret Satoshis home"
            >
              <span className="acc">{"//"}</span> SECRET SATOSHIS
            </a>
            <p className="ss-footer-tagline">
              AI-native Bitcoin market intelligence
            </p>
          </div>
          {FOOTER.map(([title, links]) => (
            <div key={title}>
              <h2 className="ss-footer-title">{title}</h2>
              <ul className="ss-footer-links">
                {links.map(([label, href, external]) => (
                  <li key={label}>
                    <a href={href} {...(external ? newTab : {})}>
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="ss-footer-bottom">
          <div>
            <span>© 2026 Secret Satoshis · Don&apos;t trust. Verify.</span>
            <span>
              Created by{" "}
              <a href="https://treybrunson.com/" {...newTab}>
                Trey Brunson
              </a>
              .
            </span>
          </div>
          <div>
            <a href={`${SITE}/privacy.html`}>Privacy</a>
            <a
              href={`${NEWSLETTER}/p/secret-satoshis-newsletter-disclaimer`}
              {...newTab}
            >
              Disclaimer
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
