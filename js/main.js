/* ═══ CHAT ANIMATION ═══ */
document.addEventListener('DOMContentLoaded', initChat);

function initChat() {
  const chatBody = document.getElementById('chatBody');
  const chatWindow = document.getElementById('chatWindow');
  const chatContinue = document.getElementById('chatContinue');
  const chatBarStatus = document.getElementById('chatBarStatus');
  if (!chatBody || !chatWindow) return;

  let conversationStarted = false;

  async function runConversation() {
    if (conversationStarted) return;
    conversationStarted = true;
    chatBody.setAttribute('aria-busy', 'true');

    const startup = document.createElement('div');
    startup.className = 'chat-startup';
    startup.setAttribute('aria-label', 'Agent 21 startup status');
    chatBody.appendChild(startup);

    await addStartupLine(startup, '// AGENT 21 STARTUP');
    await addStartupLine(startup, 'BITCOIN NODE STATUS // SYNCED');
    await addStartupLine(startup, `LATEST DATA // ${getSessionDateLabel()}`);
    await addStartupLine(startup, 'STATUS // ● LIVE', 'live');

    if (chatBarStatus) {
      chatBarStatus.textContent = 'Live';
      chatBarStatus.classList.add('is-live');
    }

    await pacedDelay(250);
    await addParticipantReply(
      chatBody,
      'agent',
      'Hey—Agent 21 here. Online and ready to go.',
      true
    );
    await pacedDelay(200);
    await addParticipantReply(chatBody, 'trey', 'Hey, Agent 21.', false);
    await pacedDelay(200);
    await addParticipantReply(
      chatBody,
      'agent',
      'Hey, Trey. What are we discussing today?',
      true
    );
    await pacedDelay(200);
    await addParticipantReply(
      chatBody,
      'trey',
      'Let’s talk through what happened last week in Bitcoin markets so I get back up to speed.',
      false
    );
    await pacedDelay(200);
    await addParticipantReply(
      chatBody,
      'agent',
      'Sounds good. I’ve got the latest market data, news flow, and on-chain data ready. Starting my review now.',
      true
    );

    if (chatContinue) chatContinue.classList.add('show');
    chatBody.setAttribute('aria-busy', 'false');
  }

  let chatIsVisible = false;
  let hasUserScrolled = false;

  function maybeStartConversation() {
    if (!chatIsVisible || !hasUserScrolled || conversationStarted) return;
    chatObs.disconnect();
    window.removeEventListener('scroll', registerUserScroll);
    runConversation();
  }

  function registerUserScroll() {
    hasUserScrolled = true;
    maybeStartConversation();
  }

  const chatObs = new IntersectionObserver((entries) => {
    chatIsVisible = entries[0].isIntersecting;
    maybeStartConversation();
  }, { threshold: 0.3 });

  chatObs.observe(chatWindow);

  // Wait until initial browser scroll restoration has settled, then require a
  // new scroll before starting the sequence.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.addEventListener('scroll', registerUserScroll, { passive: true });
    });
  });
}

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const pacedDelay = ms => prefersReducedMotion.matches ? Promise.resolve() : delay(ms);

function getSessionDateLabel() {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date()).toUpperCase();
}

async function addStartupLine(container, text, tone = '') {
  const line = document.createElement('div');
  line.className = `chat-system-line${tone ? ` is-${tone}` : ''}`;
  line.textContent = text;
  container.appendChild(line);
  requestAnimationFrame(() => line.classList.add('show'));
  await pacedDelay(200);
}

async function addParticipantReply(chatBody, from, text, typewrite) {
  if (!prefersReducedMotion.matches) {
    const typingEl = addTyping(chatBody, from);
    const typingDuration = 350;
    await delay(typingDuration);
    typingEl.remove();
  }
  return addMessage(chatBody, from, text, typewrite);
}

function addMessage(chatBody, from, text, typewrite) {
  return new Promise(resolve => {
    const msg = document.createElement('div');
    msg.className = `chat-msg from-${from}`;
    const speakerName = from === 'agent' ? 'Agent 21' : 'Trey Brunson';

    const avatar = document.createElement('div');
    avatar.className = 'chat-msg-avatar';
    avatar.textContent = from === 'agent' ? '₿' : 'TB';
    avatar.setAttribute('aria-hidden', 'true');

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';

    const speaker = document.createElement('span');
    speaker.className = 'chat-speaker';
    speaker.textContent = speakerName;

    const messageText = document.createElement('span');
    messageText.className = 'chat-message-text';

    msg.appendChild(avatar);
    msg.appendChild(bubble);
    bubble.appendChild(speaker);
    bubble.appendChild(messageText);
    chatBody.appendChild(msg);

    // Animate in
    requestAnimationFrame(() => {
      msg.classList.add('show');
    });

    if (typewrite && from === 'agent' && !prefersReducedMotion.matches) {
      messageText.setAttribute('aria-hidden', 'true');

      let i = 0;
      const type = () => {
        if (i < text.length) {
          messageText.textContent += text[i];
          i++;
          // Follow the text as it grows past the transcript's max-height.
          chatBody.scrollTop = chatBody.scrollHeight;
          setTimeout(type, 10);
        } else {
          const announcement = document.createElement('span');
          announcement.className = 'visually-hidden';
          announcement.textContent = `${speakerName}: ${text}`;
          bubble.insertBefore(announcement, messageText);
          resolve(msg);
        }
      };
      type();
    } else {
      messageText.textContent = text;
      resolve(msg);
    }

    // Scroll
    chatBody.scrollTop = chatBody.scrollHeight;
  });
}

function addTyping(chatBody, from = 'agent') {
  const msg = document.createElement('div');
  msg.className = `chat-msg from-${from} show`;
  msg.setAttribute('aria-hidden', 'true');

  const avatar = document.createElement('div');
  avatar.className = 'chat-msg-avatar';
  avatar.textContent = from === 'agent' ? '₿' : 'TB';

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  const speaker = document.createElement('span');
  speaker.className = 'chat-speaker';
  speaker.textContent = from === 'agent' ? 'Agent 21' : 'Trey Brunson';

  const typing = document.createElement('div');
  typing.className = 'chat-typing';
  for (let i = 0; i < 3; i++) {
    typing.appendChild(document.createElement('span'));
  }
  bubble.appendChild(speaker);
  bubble.appendChild(typing);

  msg.appendChild(avatar);
  msg.appendChild(bubble);
  chatBody.appendChild(msg);
  chatBody.scrollTop = chatBody.scrollHeight;
  return msg;
}

/* ═══ NAV TOGGLE ═══ */
const navToggleBtn = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');

function closeNav() {
  navLinks.classList.remove('open');
  navToggleBtn.textContent = '≡';
  navToggleBtn.setAttribute('aria-label', 'Open menu');
  navToggleBtn.setAttribute('aria-expanded', 'false');
}

function openNav() {
  navLinks.classList.add('open');
  navToggleBtn.textContent = '✕';
  navToggleBtn.setAttribute('aria-label', 'Close menu');
  navToggleBtn.setAttribute('aria-expanded', 'true');
}

if (navToggleBtn && navLinks) {
  navToggleBtn.addEventListener('click', () => {
    navLinks.classList.contains('open') ? closeNav() : openNav();
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navLinks.classList.contains('open')) {
      closeNav();
      navToggleBtn.focus();
    }
  });

  // Close when a nav link is clicked
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', closeNav);
  });

  const mobileNav = window.matchMedia('(max-width: 768px)');
  mobileNav.addEventListener('change', event => {
    if (!event.matches) closeNav();
  });
}

/* ═══ SECTION DIVIDER ANIMATION ═══ */
const dividers = document.querySelectorAll('.section-divider');
const dividerObs = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('divider-visible');
    }
  });
}, { threshold: 0, rootMargin: '0px 0px -80px 0px' });

dividers.forEach(el => dividerObs.observe(el));

/* ═══ SCROLL-FILLED RAILS ═══ */
/* Shared by the platform layers and the newsletter ladder. */
function initScrollRail(containerId, fillId, onProgress) {
  const container = document.getElementById(containerId);
  const trackFill = document.getElementById(fillId);
  if (!container || !trackFill) return;

  function updateTrack() {
    const rect = container.getBoundingClientRect();
    const viewH = window.innerHeight;
    const scrollStart = viewH * 0.6;
    const progress = Math.min(1, Math.max(0, (scrollStart - rect.top) / (rect.height)));
    trackFill.style.height = (progress * 100) + '%';
    if (onProgress) onProgress(progress, rect.height * progress);
  }

  let ticking = false;
  function requestTrackUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      updateTrack();
      ticking = false;
    });
  }

  window.addEventListener('scroll', requestTrackUpdate, { passive: true });
  window.addEventListener('resize', requestTrackUpdate);
  updateTrack();
}

initScrollRail('platformLayers', 'trackFill');

/* The ladder lights each node as the fill passes it, then the subscribe box
   once the rail is spent — so the rhythm resolves into the call to action. */
initScrollRail('newsletterLadder', 'ladderFill', (progress, filledPx) => {
  const ladder = document.getElementById('newsletterLadder');
  if (!ladder) return;

  ladder.querySelectorAll('.rung').forEach((rung) => {
    rung.classList.toggle('is-lit', filledPx > 4 && rung.offsetTop <= filledPx + 8);
  });

  const box = document.querySelector('#newsletter .subscribe-box');
  if (box) box.classList.toggle('is-lit', progress >= 0.995);
});

/* ═══ OUTLOOK TRACKER ═══ */
/*
 * Everything the tracker renders is fetched from the Report Library's published CSVs —
 * the three case levels, the year they forecast, and the daily close. Nothing is
 * hardcoded here. A local copy of the levels would be a second hand-maintained place
 * for the same published number, and the two would eventually disagree: the dashboard
 * and this page would then show different bull/base/bear levels for one forecast.
 *
 * The tracker fails closed. If either request fails, the levels are malformed, or the
 * outlook year does not match the report date's year, the section is never revealed and
 * degrades to the ladder alone — a stale number is worse than no number on a page whose
 * claim is that the data can be checked.
 */
const CSV_BASE = 'https://secretsatoshis.github.io/Bitcoin-Report-Library/csv';
const OHLC_URL = CSV_BASE + '/report_ohlc_summary.csv';
const OUTLOOK_URL = CSV_BASE + '/price_outlook.csv';

/* A hung connection would otherwise leave the promise pending forever, with the tracker
 * hidden and no diagnostic. */
const FETCH_TIMEOUT_MS = 8000;

let OUTLOOK = null;

document.addEventListener('DOMContentLoaded', initOutlookTracker);

async function initOutlookTracker() {
  const root = document.getElementById('outlookTracker');
  if (!root) return;

  let snapshot;
  let outlook;
  try {
    [snapshot, outlook] = await Promise.all([fetchLatestClose(), fetchOutlook()]);
  } catch (err) {
    return; // leave the tracker hidden
  }
  if (!snapshot || !outlook) return;

  const { close, date } = snapshot;

  // The outlook is published once a year. If it has not been refreshed for the year the
  // report belongs to, the levels are last year's — say nothing rather than label a
  // stale forecast with the current year.
  const reportYear = Number(String(date).slice(0, 4));
  if (!Number.isFinite(reportYear) || outlook.year !== reportYear) {
    console.warn(
      'Outlook tracker hidden: published outlook is for ' + outlook.year +
      ' but the report date is ' + date + '.'
    );
    return;
  }

  OUTLOOK = outlook;
  const { bear, base, bull } = OUTLOOK;

  document.getElementById('outlookYear').textContent = String(OUTLOOK.year);
  document.getElementById('outlookAsOf').textContent = 'as of ' + formatAsOf(date);

  // Case ticks: bear anchors 0%, bull anchors 100%, base falls where it falls.
  root.querySelectorAll('.outlook-tick').forEach((tick) => {
    const value = OUTLOOK[tick.dataset.case];
    tick.style.left = pctOfRange(value) + '%';
    tick.querySelector('i span').textContent = formatUsd(value);
  });

  // Marker. Clamped into the dashed overflow zone rather than pinned at a level
  // it has not reached.
  const rawPct = pctOfRange(close);
  const pct = Math.min(108.7, Math.max(-8.7, rawPct));
  const marker = document.getElementById('outlookNow');
  marker.style.left = pct + '%';
  marker.classList.toggle('is-outside', close < bear || close > bull);
  marker.classList.toggle('align-start', pct < 6);
  marker.classList.toggle('align-end', pct > 94);

  document.getElementById('outlookPrice').textContent =
    close < bear ? '\u25C2 ' + formatUsd(close)
    : close > bull ? formatUsd(close) + ' \u25B8'
    : formatUsd(close);

  document.getElementById('outlookRead').innerHTML = readingLine(close, date);
  root.hidden = false;
}

/* Fetch with an explicit deadline; a pending promise would hide the tracker silently. */
async function fetchCsv(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: 'default', signal: controller.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/*
 * Quote-aware split. The published CSVs are written by pandas, which quotes any field
 * containing a comma — `report_tables._format_fundamental_value` already produces
 * "1,611,544,931,672.75" elsewhere in csv/. A naive split(',') on such a row shifts
 * every column index, so a header lookup would silently address the wrong cell and the
 * homepage would publish a wrong price.
 */
function splitCsvRow(row) {
  const cells = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i += 1) {
    const ch = row[i];
    if (inQuotes) {
      if (ch === '"') {
        if (row[i + 1] === '"') { cell += '"'; i += 1; }  // escaped quote
        else inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

/* Parse into objects keyed by header, refusing any row whose width disagrees with the
 * header — a mismatch means the row was misread, not that a field is missing. */
function parseCsv(text) {
  const rows = String(text).trim().split(/\r?\n/);
  if (rows.length < 2) return null;

  const header = splitCsvRow(rows[0]);
  const records = [];
  for (let i = 1; i < rows.length; i += 1) {
    if (!rows[i]) continue;
    const cells = splitCsvRow(rows[i]);
    if (cells.length !== header.length) return null;
    const record = {};
    header.forEach((name, idx) => { record[name] = cells[idx]; });
    records.push(record);
  }
  return records.length ? records : null;
}

async function fetchLatestClose() {
  const text = await fetchCsv(OHLC_URL);
  if (!text) return null;
  const records = parseCsv(text);
  if (!records) return null;

  const row = records[0];
  const close = Number(row['Daily Close']);
  const date = row['Report Date'];
  if (!Number.isFinite(close) || close <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { close, date };
}

/* The three case levels and the year they forecast, straight from the published CSV. */
async function fetchOutlook() {
  const text = await fetchCsv(OUTLOOK_URL);
  if (!text) return null;
  const records = parseCsv(text);
  if (!records) return null;

  const levels = { bear: 'Bear Case', base: 'Base Case', bull: 'Bull Case' };
  const outlook = {};
  for (const [key, label] of Object.entries(levels)) {
    const match = records.find((row) => row.label === label);
    if (!match) return null;
    const price = Number(match.price);
    if (!Number.isFinite(price) || price <= 0) return null;
    outlook[key] = price;
  }

  const year = Number(records[0].outlook_year);
  if (!Number.isInteger(year)) return null;
  outlook.year = year;

  // The track maps bear→0% and bull→100%; a non-ascending set would invert it.
  if (!(outlook.bear < outlook.base && outlook.base < outlook.bull)) return null;
  return outlook;
}

/* Position on the bear→bull track, as a percentage. Uncapped; the caller clamps. */
function pctOfRange(value) {
  const { bear, bull } = OUTLOOK;
  return ((value - bear) / (bull - bear)) * 100;
}

/*
 * Always anchors on the base case first — that is the forecast — then the
 * nearest other case. Outside the range the sentence says so plainly rather
 * than reframing the target.
 */
function readingLine(close, reportDate) {
  const { bear, base, bull } = OUTLOOK;
  const weeks = weeksLeftInYear(reportDate);
  const tail = ', with ' + weeks + ' week' + (weeks === 1 ? '' : 's') + ' left in the year.';
  const lead = (text) => '<strong>' + text + '</strong>';

  if (close < bear) {
    return lead(relativeTo(close, bear, 'bear')) + ' — outside the published range' + tail;
  }
  if (close > bull) {
    return lead(relativeTo(close, bull, 'bull')) + ' — outside the published range' + tail;
  }
  if (close < base) {
    return lead(relativeTo(close, base, 'base')) + ', ' + relativeTo(close, bear, 'bear') + tail;
  }
  return lead(relativeTo(close, base, 'base')) + ', ' + relativeTo(close, bull, 'bull') + tail;
}

/*
 * Reads "12% above the bear case", or "at the base case" when the gap rounds to
 * nothing — which is precisely when a level is being tested, and when
 * "0% above the base case" would read as a mistake.
 */
function relativeTo(close, level, name) {
  const pct = Math.round(Math.abs(close - level) / level * 100);
  if (pct === 0) return 'at the ' + name + ' case';
  return pct + '% ' + (close < level ? 'below' : 'above') + ' the ' + name + ' case';
}

/* Whole weeks remaining as of the same close shown by the tracker. Deriving this from
 * the browser clock creates a year-boundary contradiction when the latest completed
 * report still belongs to 31 December. */
function weeksLeftInYear(reportDate) {
  const [year, month, day] = String(reportDate).split('-').map(Number);
  if (![year, month, day].every(Number.isInteger)) return 0;
  const asOf = Date.UTC(year, month - 1, day);
  const yearEnd = Date.UTC(year, 11, 31);
  const days = Math.max(0, Math.ceil((yearEnd - asOf) / 86400000));
  return Math.max(0, Math.round(days / 7));
}

function formatUsd(value) {
  return '$' + Math.round(value).toLocaleString('en-US');
}

function formatAsOf(isoDate) {
  const parts = String(isoDate).split('-');
  if (parts.length !== 3) return isoDate;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric', month: 'short', year: 'numeric'
  }).format(d);
}
