// Shared public-site GA4 loader. Product pages use this versioned first-party
// file; Agent 21 runs it only in its isolated public analytics frame.
(function () {
  'use strict';
  const ID = 'G-9GQYJPLLC8';
  const HOSTS = new Set([
    'secretsatoshis.com',
    'charts.secretsatoshis.com',
    'dashboard.secretsatoshis.com',
    'agent21.secretsatoshis.com',
  ]);
  if (location.protocol !== 'https:' || !HOSTS.has(location.hostname)) return;
  if (window.__ssAnalyticsLoaded) return;

  const campaignKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  function campaign(params) {
    const clean = new URLSearchParams();
    for (const key of campaignKeys) {
      const value = params.get(key);
      if (value && value.length <= 200 && !value.includes('@')) clean.set(key, value);
    }
    return clean.size ? '?' + clean.toString() : '';
  }
  function referrer(value) {
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol)) return '';
      // Never retain a private conversation path or query parameters.
      const privateAgent = url.hostname === 'agent21.secretsatoshis.com' &&
        !['/', '/waitlist'].includes(url.pathname);
      return url.origin + (privateAgent ? '/' : url.pathname);
    } catch { return ''; }
  }

  let page = location.origin + location.pathname + campaign(new URLSearchParams(location.search));
  let previous = referrer(document.referrer);
  let title = document.title;
  if (location.hostname === 'agent21.secretsatoshis.com') return;
  if (location.pathname === '/analytics.html') {
    // This cross-origin frame cannot read the Agent 21 app document. Its own
    // history is separate, so enhanced measurement cannot follow chat routes.
    if (location.hostname !== 'secretsatoshis.com') return;
    const params = new URLSearchParams(location.hash.slice(1));
    const path = params.get('path');
    if (params.get('host') !== 'agent21.secretsatoshis.com' || !['/', '/waitlist'].includes(path)) return;
    page = 'https://agent21.secretsatoshis.com' + path + campaign(params);
    previous = referrer(params.get('referrer') || '');
    title = path === '/' ? 'Agent 21 — Bitcoin-native AI Agent | Secret Satoshis' : 'Agent 21 beta waitlist | Secret Satoshis';
  }

  window.__ssAnalyticsLoaded = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', ID, {
    page_location: page,
    page_referrer: previous,
    page_title: title,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
  document.head.appendChild(script);
}());
