import translations from './i18n.js';

const mobileQuery = window.matchMedia('(max-width: 1024px)');

function t(key) {
  const lang = document.documentElement.lang || 'en';
  return (
    (translations[lang] && translations[lang].nav && translations[lang].nav[key]) ||
    (translations.en.nav && translations.en.nav[key]) ||
    key
  );
}

export function initNav() {
  const nav = document.getElementById('nav');
  const links = document.getElementById('navLinks');
  const menuBtn = document.getElementById('menuBtn');
  const backdrop = document.getElementById('navBackdrop');
  const drop = document.getElementById('navDrop');
  const dropToggle = document.getElementById('navDropToggle');
  const dropMenu = document.getElementById('navDropMenu');

  const isMobile = () => mobileQuery.matches;
  let menuOpen = false;
  let dropOpen = false;
  let hoverTimer = 0;

  function setDrop(open, restoreFocus) {
    if (!drop || !dropToggle) return;
    dropOpen = Boolean(open);
    drop.classList.toggle('open', dropOpen);
    dropToggle.setAttribute('aria-expanded', String(dropOpen));
    if (!dropOpen && restoreFocus) dropToggle.focus();
  }

  function setMenu(open) {
    if (!links || !menuBtn) return;
    menuOpen = Boolean(open) && isMobile();
    links.classList.toggle('open', menuOpen);
    menuBtn.classList.toggle('is-open', menuOpen);
    menuBtn.setAttribute('aria-expanded', String(menuOpen));
    menuBtn.setAttribute('aria-label', t(menuOpen ? 'menuClose' : 'menuOpen'));
    const icon = menuBtn.querySelector('iconify-icon');
    if (icon) {
      icon.setAttribute('icon', menuOpen ? 'solar:close-square-linear' : 'solar:hamburger-menu-linear');
    }
    if (backdrop) backdrop.classList.toggle('open', menuOpen);
    document.body.classList.toggle('nav-open', menuOpen);
    if (!menuOpen) setDrop(false);
  }

  menuBtn?.addEventListener('click', () => setMenu(!menuOpen));

  links?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      if (isMobile()) setMenu(false);
    });
  });

  backdrop?.addEventListener('click', () => setMenu(false));

  dropToggle?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDrop(!dropOpen);
  });

  drop?.addEventListener('mouseenter', () => {
    if (isMobile()) return;
    window.clearTimeout(hoverTimer);
    setDrop(true);
  });

  drop?.addEventListener('mouseleave', () => {
    if (isMobile()) return;
    hoverTimer = window.setTimeout(() => setDrop(false), 140);
  });

  dropMenu?.addEventListener('mouseenter', () => window.clearTimeout(hoverTimer));

  drop?.addEventListener('focusout', (event) => {
    if (!drop.contains(event.relatedTarget)) setDrop(false);
  });

  // Language dropdown (header)
  const langWrap = document.getElementById('langSwitcher');
  const langToggle = document.getElementById('langToggle');
  let langOpen = false;

  function setLangMenu(open) {
    if (!langWrap || !langToggle) return;
    langOpen = Boolean(open);
    langWrap.classList.toggle('open', langOpen);
    langToggle.setAttribute('aria-expanded', String(langOpen));
  }

  langToggle?.addEventListener('click', (event) => {
    event.stopPropagation();
    setLangMenu(!langOpen);
  });

  langWrap?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => setLangMenu(false));
  });

  langWrap?.addEventListener('focusout', (event) => {
    if (!langWrap.contains(event.relatedTarget)) setLangMenu(false);
  });

  document.addEventListener('click', (event) => {
    if (drop && !drop.contains(event.target)) setDrop(false);
    if (langWrap && !langWrap.contains(event.target)) setLangMenu(false);
    if (menuOpen && links && !links.contains(event.target) && !menuBtn.contains(event.target)) {
      setMenu(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (langOpen) {
      setLangMenu(false);
      langToggle.focus();
    } else if (dropOpen) {
      setDrop(false, true);
    } else if (menuOpen) {
      setMenu(false);
      menuBtn.focus();
    }
  });

  const onViewportChange = () => {
    setMenu(false);
    setDrop(false);
  };

  if (mobileQuery.addEventListener) {
    mobileQuery.addEventListener('change', onViewportChange);
  } else {
    mobileQuery.addListener(onViewportChange);
  }

  document.addEventListener('bnos:lang', () => {
    if (menuBtn) menuBtn.setAttribute('aria-label', t(menuOpen ? 'menuClose' : 'menuOpen'));
  });

  // Sticky header state
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // Current-section highlighting for in-page anchors (home page)
  if (links) {
    const items = [];
    links.querySelectorAll('a[href^="#"]').forEach((link) => {
      const id = link.getAttribute('href');
      const section = id && id.length > 1 ? document.querySelector(id) : null;
      if (section) items.push({ control: link, section });
    });

    if (dropToggle && dropToggle.dataset.spyTarget) {
      const section = document.querySelector(dropToggle.dataset.spyTarget);
      if (section) items.push({ control: dropToggle, section });
    }

    items.sort(
      (a, b) =>
        a.section.getBoundingClientRect().top + window.scrollY -
        (b.section.getBoundingClientRect().top + window.scrollY),
    );

    if (items.length) {
      let ticking = false;
      const update = () => {
        ticking = false;
        const offset = (nav ? nav.offsetHeight : 68) + 96;
        let active = null;

        items.forEach((item) => {
          if (item.section.getBoundingClientRect().top <= offset) active = item;
        });

        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
          active = items[items.length - 1];
        }

        items.forEach(({ control }) => {
          const current = control === (active && active.control);
          control.classList.toggle('active', current);
          if (current) {
            control.setAttribute('aria-current', 'location');
          } else {
            control.removeAttribute('aria-current');
          }
        });
      };

      const requestUpdate = () => {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(update);
      };

      window.addEventListener('scroll', requestUpdate, { passive: true });
      window.addEventListener('resize', requestUpdate);
      window.addEventListener('hashchange', requestUpdate);
      update();
    }
  }

  setMenu(false);
}

initNav();
