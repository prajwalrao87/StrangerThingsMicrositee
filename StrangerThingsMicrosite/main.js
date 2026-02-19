import { initArExperience } from './js/ar/app.js';

const navLinks = Array.from(document.querySelectorAll('.menu a'));
const sections = Array.from(document.querySelectorAll('main section[id]'));
const topbar = document.querySelector('.topbar');
const modal = document.getElementById('trailerModal');
const trailerIframe = modal?.querySelector('iframe') || null;
const trailerSrc = trailerIframe?.getAttribute('src') || '';
const openButtons = document.querySelectorAll('[data-open-trailer]');
const closeButtons = document.querySelectorAll('[data-close-trailer]');
const siteBg = document.querySelector('.site-bg');
const hero = document.querySelector('.hero');
const footerReveal = document.querySelector('.footer-reveal');
const upsideEnterBtn = document.getElementById('upsideEnterBtn');
const upsideExitBtn = document.getElementById('upsideExitBtn');
const diceOverlay = document.getElementById('diceOverlay');
const diceBtn = document.getElementById('diceBtn');
const diceFace = document.getElementById('diceFace');
const diceCloseBtn = document.getElementById('diceCloseBtn');
const diceHint = document.getElementById('diceHint');
const arLaunchImage = document.querySelector('#arLaunchBtn img');
const upsidePanel = document.getElementById('upside-down');
const upsidePortal = document.querySelector('.upside-portal');
const riftSignalLine = document.getElementById('riftSignalLine');
const frameTargets = Array.from(document.querySelectorAll('.hero, .panel:not(.panel-ar), .upside-portal, .site-footer'));

if (diceOverlay && diceOverlay.parentElement !== document.body) {
  document.body.appendChild(diceOverlay);
}

if (arLaunchImage) {
  arLaunchImage.addEventListener('error', () => {
    arLaunchImage.classList.add('is-broken');
  }, { once: true });
  arLaunchImage.addEventListener('load', () => {
    arLaunchImage.classList.remove('is-broken');
  });
}

const navEntry = performance.getEntriesByType('navigation')[0];
const isReloadNavigation = navEntry?.type === 'reload';
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

let targetX = 0;
let targetY = 0;
let currentX = 0;
let currentY = 0;
let parallaxEnabled = true;
let upsideThemeTimer;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobileOrTouch = window.matchMedia('(max-width: 900px), (hover: none), (pointer: coarse)').matches;

function setActiveLink() {
  const scrollPos = window.scrollY + 140;
  let currentId = sections[0]?.id;

  sections.forEach((section) => {
    if (section.offsetTop <= scrollPos) currentId = section.id;
  });

  navLinks.forEach((link) => {
    const isActive = link.getAttribute('href') === `#${currentId}`;
    link.classList.toggle('active', isActive);
  });
}

function scrollToSection(hash) {
  if (!hash || !hash.startsWith('#')) return;
  const target = document.querySelector(hash);
  if (!target) return;

  const topbarHeight = topbar ? topbar.getBoundingClientRect().height : 0;
  const targetTop = target.getBoundingClientRect().top + window.scrollY;
  const offset = topbarHeight + 20;

  window.scrollTo({
    top: Math.max(0, targetTop - offset),
    behavior: 'smooth'
  });
}

function smoothScrollToTop(durationMs = 900) {
  if (reduceMotion) {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    return;
  }

  const startY = window.scrollY;
  if (startY <= 0) return;

  const startTime = performance.now();
  const easeOutCubic = (t) => 1 - ((1 - t) ** 3);

  const tick = (now) => {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / durationMs);
    const eased = easeOutCubic(progress);
    const nextY = Math.round(startY * (1 - eased));
    window.scrollTo({ top: nextY, left: 0, behavior: 'auto' });
    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  };

  requestAnimationFrame(tick);
}

function handleReloadToLanding() {
  if (!isReloadNavigation) return;
  window.addEventListener('load', () => {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}#home`);
    requestAnimationFrame(() => {
      smoothScrollToTop(950);
      setActiveLink();
    });
  }, { once: true });
}
handleReloadToLanding();

function openTrailer() {
  if (!modal) return;
  if (trailerIframe && !trailerIframe.getAttribute('src') && trailerSrc) {
    trailerIframe.setAttribute('src', trailerSrc);
  }
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeTrailer() {
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (trailerIframe) {
    trailerIframe.setAttribute('src', '');
  }
}

function setUpsideState(isOn) {
  clearTimeout(upsideThemeTimer);

  if (isOn) {
    parallaxEnabled = false;
    if (siteBg) siteBg.style.transform = 'translate3d(0, 0, 0) scale(1)';
    if (hero) hero.style.transform = 'translate3d(0, 0, 0)';
    document.body.classList.add('upside-down');
    upsideThemeTimer = setTimeout(() => {
      document.body.classList.add('upside-theme');
    }, 340);
    return;
  }

  document.body.classList.remove('upside-theme');
  document.body.classList.remove('upside-down');
  parallaxEnabled = true;
}

function openDiceOverlay() {
  if (!diceOverlay) return;
  diceOverlay.classList.add('open');
  diceOverlay.setAttribute('aria-hidden', 'false');
  if (diceFace) diceFace.textContent = '?';
  if (diceHint) diceHint.textContent = 'Roll to enter the Upside Down';
}

function closeDiceOverlay() {
  if (!diceOverlay) return;
  diceOverlay.classList.remove('open');
  diceOverlay.setAttribute('aria-hidden', 'true');
}

function updateRiftSignal() {
  if (!riftSignalLine) return;

  const signals = [
    'TRANSMISSION LOCKED: FIND THE CLOCK.',
    'PORTAL PRESSURE RISING UNDER HAWKINS LAB.',
    'VECNA SIGNAL DETECTED IN CREEL HOUSE.',
    'RIFT DRIFT CONFIRMED: EAST OF STARCOURT.',
    'EYES OPEN. STAY OFF THE MAIN ROAD.'
  ];

  let index = 0;
  window.setInterval(() => {
    index = (index + 1) % signals.length;
    riftSignalLine.textContent = signals[index];
    riftSignalLine.classList.remove('glitch');
    void riftSignalLine.offsetWidth;
    riftSignalLine.classList.add('glitch');
  }, 3200);
}

function animateParallax() {
  if (!parallaxEnabled) {
    requestAnimationFrame(animateParallax);
    return;
  }

  currentX += (targetX - currentX) * 0.08;
  currentY += (targetY - currentY) * 0.08;

  if (siteBg) {
    siteBg.style.transform = `translate3d(${currentX * 10}px, ${currentY * 8}px, 0) scale(1.03)`;
  }
  if (hero) {
    hero.style.transform = `translate3d(${currentX * -8}px, ${currentY * -6}px, 0)`;
  }

  requestAnimationFrame(animateParallax);
}

openButtons.forEach((button) => button.addEventListener('click', openTrailer));
closeButtons.forEach((button) => button.addEventListener('click', closeTrailer));
navLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    const hash = link.getAttribute('href');
    if (!hash || !hash.startsWith('#')) return;
    event.preventDefault();
    scrollToSection(hash);
    history.replaceState(null, '', hash);
    setActiveLink();
  });
});

window.addEventListener('scroll', setActiveLink, { passive: true });
setActiveLink();

window.addEventListener('mousemove', (event) => {
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  targetX = (event.clientX - centerX) / centerX;
  targetY = (event.clientY - centerY) / centerY;
});

window.addEventListener('deviceorientation', (event) => {
  if (event.gamma == null || event.beta == null) return;
  targetX = Math.max(-1, Math.min(1, event.gamma / 35));
  targetY = Math.max(-1, Math.min(1, event.beta / 45));
}, { passive: true });

if (upsideEnterBtn) {
  upsideEnterBtn.addEventListener('click', openDiceOverlay);
}
if (diceCloseBtn) {
  diceCloseBtn.addEventListener('click', closeDiceOverlay);
}
if (diceOverlay) {
  diceOverlay.addEventListener('click', (event) => {
    if (event.target === diceOverlay) closeDiceOverlay();
  });
}
if (diceBtn) {
  let rolling = false;
  diceBtn.addEventListener('click', () => {
    if (rolling) return;
    rolling = true;
    diceBtn.classList.add('rolling');

    let tick = 0;
    const spin = setInterval(() => {
      tick += 1;
      const randomVal = Math.floor(Math.random() * 5) + 1;
      if (diceFace) diceFace.textContent = String(randomVal);

      if (tick >= 10) {
        clearInterval(spin);
        const finalRoll = 5;
        if (diceFace) diceFace.textContent = String(finalRoll);
        if (diceHint) diceHint.textContent = `Rolled ${finalRoll}. Entering the Upside Down...`;
        setTimeout(() => {
          setUpsideState(true);
          closeDiceOverlay();
          diceBtn.classList.remove('rolling');
          rolling = false;
        }, 650);
      }
    }, 80);
  });
}
if (upsideExitBtn) {
  upsideExitBtn.addEventListener('click', () => {
    setUpsideState(false);
    closeDiceOverlay();
  });
}
if (upsidePanel) {
  upsidePanel.addEventListener('mousemove', (event) => {
    const rect = upsidePanel.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    upsidePanel.style.setProperty('--rift-x', `${x}%`);
    upsidePanel.style.setProperty('--rift-y', `${y}%`);
  });

  upsidePanel.addEventListener('mouseleave', () => {
    upsidePanel.style.setProperty('--rift-x', '50%');
    upsidePanel.style.setProperty('--rift-y', '50%');
  });
}

if (upsidePortal) {
  const setPortalHue = (event) => {
    const rect = upsidePortal.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    document.body.classList.toggle('portal-blue', x >= 0.5);
  };
  const setPortalHueFromTouch = (touch) => {
    const rect = upsidePortal.getBoundingClientRect();
    const x = (touch.clientX - rect.left) / rect.width;
    document.body.classList.toggle('portal-blue', x >= 0.5);
  };

  upsidePortal.addEventListener('pointermove', setPortalHue);
  upsidePortal.addEventListener('pointerenter', () => {
    document.body.classList.add('portal-active');
  });
  upsidePortal.addEventListener('pointerleave', () => {
    document.body.classList.remove('portal-active');
    document.body.classList.remove('portal-blue');
  });
  upsidePortal.addEventListener('touchstart', (event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    document.body.classList.add('portal-active');
    setPortalHueFromTouch(touch);
  }, { passive: true });
  upsidePortal.addEventListener('touchmove', (event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    setPortalHueFromTouch(touch);
  }, { passive: true });
  upsidePortal.addEventListener('touchend', () => {
    document.body.classList.remove('portal-active');
    document.body.classList.remove('portal-blue');
  }, { passive: true });
  upsidePortal.addEventListener('touchcancel', () => {
    document.body.classList.remove('portal-active');
    document.body.classList.remove('portal-blue');
  }, { passive: true });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeTrailer();
    closeDiceOverlay();
  }
});

if (footerReveal && 'IntersectionObserver' in window) {
  const footerObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        footerReveal.classList.add('in-view');
        footerObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.25 });
  footerObserver.observe(footerReveal);
} else if (footerReveal) {
  footerReveal.classList.add('in-view');
}

if (frameTargets.length) {
  frameTargets.forEach((el) => {
    el.classList.add('frame-tilt', 'frame-reveal');
    el.style.setProperty('--glow-x', '50%');
    el.style.setProperty('--glow-y', '50%');
  });

  if (!reduceMotion && !mobileOrTouch) {
    frameTargets.forEach((el) => {
      let rafId;
      const handleMove = (event) => {
        const rect = el.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        const tiltX = (x - 0.5) * 10;
        const tiltY = (0.5 - y) * 8;

        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          el.style.setProperty('--tilt-x', `${tiltX.toFixed(2)}deg`);
          el.style.setProperty('--tilt-y', `${tiltY.toFixed(2)}deg`);
          el.style.setProperty('--glow-x', `${(x * 100).toFixed(1)}%`);
          el.style.setProperty('--glow-y', `${(y * 100).toFixed(1)}%`);
        });
      };

      const handleLeave = () => {
        el.style.setProperty('--tilt-x', '0deg');
        el.style.setProperty('--tilt-y', '0deg');
        el.style.setProperty('--glow-x', '50%');
        el.style.setProperty('--glow-y', '50%');
      };

      el.addEventListener('pointermove', handleMove);
      el.addEventListener('pointerleave', handleLeave);
    });
  }

  if (mobileOrTouch || !('IntersectionObserver' in window)) {
    frameTargets.forEach((el) => el.classList.add('is-revealed'));
  } else {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          revealObserver.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.08,
      rootMargin: '0px 0px -10% 0px'
    });

    frameTargets.forEach((el) => revealObserver.observe(el));
  }
}

animateParallax();
updateRiftSignal();
initArExperience();
