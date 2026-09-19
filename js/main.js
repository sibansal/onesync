/* ==========================================================================
   OneSync Landing Page JavaScript
   Interactive animations, tab switching, and 3D card tilt
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Header scroll effect
  const header = document.querySelector('.site-header');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 20) {
      header?.classList.add('scrolled');
    } else {
      header?.classList.remove('scrolled');
    }
  });

  // 2. Mobile menu toggle
  const mobileToggle = document.querySelector('.mobile-toggle');
  const navLinks = document.querySelector('.nav-links');
  if (mobileToggle && navLinks) {
    mobileToggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      const isOpen = navLinks.classList.contains('open');
      mobileToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  // 3. Interactive Screenshot Showcase Tabs
  const tabs = document.querySelectorAll('.showcase-tab');
  const image = document.getElementById('showcase-image');
  const title = document.getElementById('showcase-title');
  const caption = document.getElementById('showcase-caption-text');
  const badge = document.getElementById('showcase-badge');

  const screenshots = {
    connect: {
      src: 'assets/screenshot-connect.png',
      alt: 'OneSync Connect to OneDrive Screen',
      title: 'OneSync — Connect to OneDrive',
      badge: 'OAuth 2.0 PKCE',
      caption: 'Initial connection screen ensuring atomic, one-way cloud mirroring with zero write permissions.'
    },
    dashboard: {
      src: 'assets/screenshot-dashboard.png',
      alt: 'OneSync Active Sync Dashboard & Console',
      title: 'OneSync — Active Sync & Preflight Engine',
      badge: 'Real-time Console',
      caption: 'Real-time sync dashboard showing preflight discovery, hash validation, dynamic console logs, and counters.'
    }
  };

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const target = tab.getAttribute('data-target');
      const data = screenshots[target];

      if (data && image) {
        image.style.opacity = '0';
        setTimeout(() => {
          image.src = data.src;
          image.alt = data.alt;
          if (title) title.textContent = data.title;
          if (caption) caption.textContent = data.caption;
          if (badge) badge.textContent = data.badge;
          image.style.opacity = '1';
        }, 150);
      }
    });
  });

  // 4. 3D Tilt Card effect (matching TiltCard.jsx logic)
  const tiltCards = document.querySelectorAll('.tilt-card, .showcase-window');
  tiltCards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = ((y - centerY) / centerY) * -4;
      const rotateY = ((x - centerX) / centerX) * 4;

      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.01, 1.01, 1.01)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
    });
  });

  // 5. Ambient glow mouse follower (subtle, non-intrusive)
  const ambientGlow = document.createElement('div');
  ambientGlow.style.position = 'fixed';
  ambientGlow.style.width = '400px';
  ambientGlow.style.height = '400px';
  ambientGlow.style.borderRadius = '50%';
  ambientGlow.style.background = 'radial-gradient(circle, rgba(83, 142, 151, 0.07) 0%, transparent 70%)';
  ambientGlow.style.pointerEvents = 'none';
  ambientGlow.style.zIndex = '0';
  ambientGlow.style.filter = 'blur(60px)';
  ambientGlow.style.transition = 'transform 0.15s ease-out';
  ambientGlow.style.transform = 'translate(-50%, -50%)';
  ambientGlow.style.opacity = '0';
  document.body.appendChild(ambientGlow);

  let mouseMoved = false;
  window.addEventListener('mousemove', (e) => {
    if (!mouseMoved) {
      ambientGlow.style.opacity = '1';
      mouseMoved = true;
    }
    ambientGlow.style.left = `${e.clientX}px`;
    ambientGlow.style.top = `${e.clientY}px`;
  });
});
