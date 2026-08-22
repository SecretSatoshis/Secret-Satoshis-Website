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

    await pacedDelay(900);
    await addParticipantReply(
      chatBody,
      'agent',
      'Hey—Agent 21 here. Online and ready to go.',
      true
    );
    await pacedDelay(900);
    await addParticipantReply(chatBody, 'trey', 'Hey, Agent 21.', false);
    await pacedDelay(850);
    await addParticipantReply(
      chatBody,
      'agent',
      'Hey, Trey. What are we discussing today?',
      true
    );
    await pacedDelay(900);
    await addParticipantReply(
      chatBody,
      'trey',
      'Bitcoin’s latest move. I have a few thoughts on what happened.',
      false
    );
    await pacedDelay(850);
    await addParticipantReply(
      chatBody,
      'agent',
      'Sounds good. I’ve got the latest market data, news flow, and on-chain data ready. Wherever you want to take it.',
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
  await pacedDelay(750);
}

async function addParticipantReply(chatBody, from, text, typewrite) {
  if (!prefersReducedMotion.matches) {
    const typingEl = addTyping(chatBody, from);
    const millisecondsPerCharacter = from === 'trey' ? 34 : 24;
    const typingDuration = Math.min(
      3200,
      Math.max(850, 500 + (text.length * millisecondsPerCharacter))
    );
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
          setTimeout(type, 24);
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

/* ═══ PLATFORM SCROLL ACTIVATION ═══ */
function initPlatformScroll() {
  const container = document.getElementById('platformLayers');
  const trackFill = document.getElementById('trackFill');
  if (!container || !trackFill) return;

  // Track fill follows scroll progress
  function updateTrack() {
    const rect = container.getBoundingClientRect();
    const viewH = window.innerHeight;
    const scrollStart = viewH * 0.6;
    const progress = Math.min(1, Math.max(0, (scrollStart - rect.top) / (rect.height)));
    trackFill.style.height = (progress * 100) + '%';
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

initPlatformScroll();
