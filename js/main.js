/* ═══ TYPEWRITER ═══ */
document.addEventListener('DOMContentLoaded', () => {
  // Start nav and hero typewriters
  setTimeout(typeNavLabel, 100);
  setTimeout(typeHeroLabel, 300);

  /* ═══ CHAT ANIMATION ═══ */
  initChat();
});

function initChat() {
  const chatBody = document.getElementById('chatBody');
  const chatContinue = document.getElementById('chatContinue');
  if (!chatBody) return;

  const greeting = "Agent 21 is an AI agent built to help you explore and analyze Bitcoin through structured research.\n\nExplore Bitcoin — from fundamentals to market structure.\nWhat would you like to explore?";

  function showGreeting() {
    chatBody.replaceChildren();
    addMessage(chatBody, 'agent', greeting, true);
  }

  // Trigger greeting when chat scrolls into view
  const chatObs = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      showGreeting();
      chatObs.disconnect();
    }
  }, { threshold: 0.3 });
  
  const chatWindow = document.getElementById('chatWindow');
  if (!chatWindow) return;
  chatObs.observe(chatWindow);

  // Suggestion button handlers
  const suggestBtns = document.querySelectorAll('.chat-suggest-btn');
  suggestBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const q = btn.dataset.q;
      const a = btn.dataset.a;
      const ctaIntro = btn.dataset.ctaIntro;
      const cta = btn.dataset.cta;
      const ctaUrl = btn.dataset.ctaUrl;

      // Mark as used
      btn.classList.add('used');

      // Add user message
      addMessage(chatBody, 'user', q, false);

      // Show typing then response
      if (prefersReducedMotion.matches) {
        addMessage(chatBody, 'agent', a, false, ctaIntro, cta, ctaUrl);
        chatBody.scrollTop = chatBody.scrollHeight;
        if (chatContinue) chatContinue.classList.add('show');
      } else {
        setTimeout(() => {
          const typingEl = addTyping(chatBody);
          setTimeout(() => {
            typingEl.remove();
            addMessage(chatBody, 'agent', a, true, ctaIntro, cta, ctaUrl);
            chatBody.scrollTop = chatBody.scrollHeight;
            if (chatContinue) chatContinue.classList.add('show');
          }, 1200);
        }, 400);
      }
    });
  });
}

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function typeNavLabel() {
  const el = document.getElementById('navTypewriter');
  if (!el) return;
  const text = 'SECRET SATOSHIS';
  if (prefersReducedMotion.matches) {
    el.textContent = text;
    return;
  }
  let i = 0;
  const type = () => {
    if (i < text.length) {
      el.textContent += text[i];
      i++;
      setTimeout(type, 80);
    }
  };
  type();
}

function typeHeroLabel() {
  const el = document.getElementById('heroTypewriter');
  if (!el) return;
  const text = 'Secret Satoshis';
  if (prefersReducedMotion.matches) {
    el.textContent = text;
    el.classList.add('done');
    return;
  }
  let i = 0;
  const type = () => {
    if (i < text.length) {
      el.textContent += text[i];
      i++;
      setTimeout(type, 80); // Slower: 80ms per character
    } else {
      // Stop cursor after 21 blinks (21 × 800ms = 16,800ms)
      setTimeout(() => el.classList.add('done'), 16800);
    }
  };
  type();
}

function addMessage(chatBody, from, text, typewrite, ctaIntro, cta, ctaUrl) {
  const msg = document.createElement('div');
  msg.className = `chat-msg from-${from}`;

  const avatar = document.createElement('div');
  avatar.className = 'chat-msg-avatar';
  avatar.textContent = from === 'agent' ? '₿' : 'You';

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  msg.appendChild(avatar);
  msg.appendChild(bubble);
  chatBody.appendChild(msg);

  // Animate in
  requestAnimationFrame(() => {
    msg.classList.add('show');
  });

  function appendCta() {
    if (cta && ctaUrl) {
      const wrapper = document.createElement('div');
      wrapper.className = 'chat-cta-wrapper';

      if (ctaIntro) {
        const intro = document.createElement('span');
        intro.className = 'chat-cta-intro';
        intro.textContent = ctaIntro;
        wrapper.appendChild(intro);
      }

      const link = document.createElement('a');
      link.href = ctaUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'chat-cta-link';
      link.textContent = '→ ' + cta;
      wrapper.appendChild(link);

      bubble.appendChild(wrapper);
      chatBody.scrollTop = chatBody.scrollHeight;
    }
  }

  if (typewrite && from === 'agent' && !prefersReducedMotion.matches) {
    let i = 0;
    const type = () => {
      if (i < text.length) {
        bubble.textContent += text[i];
        i++;
        setTimeout(type, 14);
      } else {
        appendCta();
      }
    };
    type();
  } else {
    bubble.textContent = text;
    appendCta();
  }

  // Scroll
  chatBody.scrollTop = chatBody.scrollHeight;
  return msg;
}

function addTyping(chatBody) {
  const msg = document.createElement('div');
  msg.className = 'chat-msg from-agent show';

  const avatar = document.createElement('div');
  avatar.className = 'chat-msg-avatar';
  avatar.textContent = '₿';

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  const typing = document.createElement('div');
  typing.className = 'chat-typing';
  for (let i = 0; i < 3; i++) {
    typing.appendChild(document.createElement('span'));
  }
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
  navToggleBtn.setAttribute('aria-expanded', 'false');
}

function openNav() {
  navLinks.classList.add('open');
  navToggleBtn.textContent = '✕';
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

/* ═══ SECTION TYPEWRITER ═══ */
const sectionTypewriters = document.querySelectorAll('.section-typewriter');
const typewriterObs = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      typewriterObs.unobserve(entry.target);
      const el = entry.target;
      const text = el.dataset.text;

      // Check if element is inside a section with divider
      const section = el.closest('.section-divider');
      const hasDivider = section !== null;

      // Divider animation takes 1000ms + 300ms buffer = 1300ms
      const delay = hasDivider ? 1300 : 0;

      if (prefersReducedMotion.matches) {
        setTimeout(() => {
          el.textContent = text;
          el.classList.add('done');
        }, delay);
        return;
      }

      setTimeout(() => {
        let i = 0;
        const type = () => {
          if (i < text.length) {
            el.textContent += text[i];
            i++;
            setTimeout(type, 80); // Slower: 80ms per character
          } else {
            setTimeout(() => el.classList.add('done'), 1500);
          }
        };
        type();
      }, delay);
    }
  });
}, { threshold: 0.3 });

sectionTypewriters.forEach(el => typewriterObs.observe(el));

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
  window.addEventListener('scroll', updateTrack, { passive: true });
  updateTrack();
}

initPlatformScroll();
