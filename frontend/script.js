// ===== DARK MODE TOGGLE =====
const themeToggle = document.getElementById('theme-toggle');
const root = document.documentElement;

// Check saved preference or system preference
const savedTheme = localStorage.getItem('chainpe-theme');
if (savedTheme) {
  root.setAttribute('data-theme', savedTheme);
} else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
  root.setAttribute('data-theme', 'dark');
}

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const current = root.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    if (next === 'light') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', 'dark');
    }
    localStorage.setItem('chainpe-theme', next);
  });
}

// ===== INSTALL TAB SWITCHER =====
const installCommands = {
  npm: 'npm install @chainpe/agent',
  yarn: 'yarn add @chainpe/agent',
  pnpm: 'pnpm add @chainpe/agent'
};

document.querySelectorAll('.install-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.install-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const command = installCommands[tab.dataset.tab];
    document.getElementById('install-command').textContent = command;
  });
});

// ===== COPY TO CLIPBOARD =====
const copyBtn = document.getElementById('copy-btn');
if (copyBtn) {
  copyBtn.addEventListener('click', async () => {
    const code = document.getElementById('install-command').textContent;
    try {
      await navigator.clipboard.writeText(code);
      copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => {
        copyBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      }, 2000);
    } catch (e) {
      console.error('Copy failed', e);
    }
  });
}

// ===== MOBILE MENU TOGGLE =====
const menuToggle = document.getElementById('mobile-menu-toggle');
const nav = document.getElementById('nav');

if (menuToggle && nav) {
  menuToggle.addEventListener('click', () => {
    nav.classList.toggle('open');
    menuToggle.classList.toggle('active');
  });

  // Close menu on nav link click
  nav.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      menuToggle.classList.remove('active');
    });
  });
}

// ===== SCROLL REVEAL =====
const revealElements = document.querySelectorAll('.section-title, .section-description, .features-list, .stats-grid, .use-cases-grid, .faq-list, .video-wrapper, .waitlist-form');

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('reveal', 'visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, {
  threshold: 0.1,
  rootMargin: '0px 0px -40px 0px'
});

revealElements.forEach(el => {
  el.classList.add('reveal');
  revealObserver.observe(el);
});

// ===== SMOOTH SCROLL FOR ANCHOR LINKS =====
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const href = this.getAttribute('href');
    if (href === '#') return;
    e.preventDefault();
    const target = document.querySelector(href);
    if (target) {
      const headerH = document.querySelector('.header').offsetHeight;
      const targetPos = target.getBoundingClientRect().top + window.pageYOffset - headerH - 16;
      window.scrollTo({ top: targetPos, behavior: 'smooth' });
    }
  });
});

// ===== WAITLIST FORM =====
const form = document.getElementById('waitlist-form');
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = form.querySelector('.waitlist-input');
    const btn = form.querySelector('.btn-primary');
    const originalText = btn.textContent;
    btn.textContent = 'Added ✓';
    btn.style.background = '#059669';
    input.value = '';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '';
    }, 2500);
  });
}
