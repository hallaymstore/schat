(function () {
  if (window.__hallaymOfficialNavReady) return;
  window.__hallaymOfficialNavReady = true;

  var doc = document;
  var root = doc.documentElement;
  var pathname = String(window.location.pathname || '');
  var filename = pathname.split('/').pop() || 'index.html';
  var isLanding = filename === '' || filename === 'index.html';

  function landingHref(hash) {
    if (!hash) return '/index.html';
    return isLanding ? hash : '/index.html' + hash;
  }

  var menuGroups = [
    {
      label: 'Rasmiy sahifalar',
      items: [
        { href: '/about.html', icon: 'fa-solid fa-building-columns', title: 'About', desc: 'Platforma, missiya va rasmiy pozitsiya' },
        { href: '/guide.html', icon: 'fa-solid fa-map-signs', title: "Qo'llanma", desc: 'Asosiy oqim va foydalanish xaritasi' },
        { href: '/faq.html', icon: 'fa-solid fa-circle-question', title: 'FAQ', desc: "Ko'p beriladigan savollar" },
        { href: '/contact.html', icon: 'fa-solid fa-address-book', title: 'Aloqa', desc: 'Demo, yordam va hamkorlik kanallari' }
      ]
    },
    {
      label: "Landing bo'limlari",
      items: [
        { href: landingHref('#imkoniyatlar'), icon: 'fa-solid fa-layer-group', title: 'Imkoniyatlar', desc: 'Platforma yadro imkoniyatlari' },
        { href: landingHref('#qanday-ishlaydi'), icon: 'fa-solid fa-diagram-project', title: 'Jarayon', desc: 'Ishlash ketma-ketligi va foydalanuvchi oqimi' },
        { href: landingHref('#galereya'), icon: 'fa-solid fa-photo-film', title: 'Galereya', desc: "Interfeys va premium ko'rinish namunalari" },
        { href: landingHref('#xizmatlar'), icon: 'fa-solid fa-store', title: 'Xizmatlar', desc: 'Campus ichidagi xizmat ekotizimi' },
        { href: landingHref('#signal'), icon: 'fa-solid fa-bell', title: 'Campus Signal', desc: 'Muammo va feedback oqimi' },
        { href: landingHref('#faq'), icon: 'fa-solid fa-file-lines', title: 'Landing FAQ', desc: "Bosh sahifadagi tezkor savollar bo'limi" }
      ]
    },
    {
      label: 'Platforma',
      items: [
        { href: '/lives.html', icon: 'fa-solid fa-video', title: 'Live darslar', desc: 'Jonli darslar va oqimlar' },
        { href: '/channels.html', icon: 'fa-solid fa-bullhorn', title: 'Kanallar', desc: "Rasmiy e'lon va media oqimi" },
        { href: '/groups.html', icon: 'fa-solid fa-people-group', title: 'Guruhlar', desc: 'Talabalar va fan guruhlari' },
        { href: '/messages.html', icon: 'fa-regular fa-comments', title: 'Xabarlar', desc: 'Ichki muloqot va yozishmalar' }
      ]
    }
  ];

  var footerLinks = [
    { href: '/login.html', icon: 'fa-solid fa-right-to-bracket', title: 'Kirish', desc: 'Mavjud hisobga ulanish' },
    { href: '/register.html', icon: 'fa-solid fa-user-plus', title: "Ro'yxatdan o'tish", desc: 'Yangi foydalanuvchi ochish' }
  ];

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isActiveHref(href) {
    if (!href) return false;
    if (href.charAt(0) === '#') {
      return isLanding && window.location.hash === href;
    }
    if (href.indexOf('#') !== -1) {
      var parts = href.split('#');
      var targetPath = parts[0] || '/index.html';
      var targetHash = '#' + parts[1];
      return pathname.endsWith(targetPath) && window.location.hash === targetHash;
    }
    return pathname === href || pathname.endsWith(href.replace(/^\//, ''));
  }

  function renderLinks(items) {
    return items.map(function (item) {
      return (
        '<a class="official-menu__link' + (isActiveHref(item.href) ? ' is-active' : '') + '" href="' + escapeHtml(item.href) + '">' +
          '<i class="' + escapeHtml(item.icon) + '"></i>' +
          '<span class="official-menu__link-copy">' +
            '<strong>' + escapeHtml(item.title) + '</strong>' +
            '<small>' + escapeHtml(item.desc) + '</small>' +
          '</span>' +
        '</a>'
      );
    }).join('');
  }

  function ensureMenu() {
    var overlay = doc.getElementById('mobileMenuOverlay');
    if (!overlay) {
      overlay = doc.createElement('div');
      overlay.id = 'mobileMenuOverlay';
      overlay.className = 'official-menu-overlay';
      doc.body.appendChild(overlay);
    } else {
      overlay.classList.add('official-menu-overlay');
    }

    var panel = doc.getElementById('mobileMenu');
    if (!panel) {
      panel = doc.createElement('aside');
      panel.id = 'mobileMenu';
      panel.className = 'official-menu';
      doc.body.appendChild(panel);
    } else {
      panel.className = 'official-menu';
    }

    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = [
      '<div class="official-menu__panel">',
      '  <div class="official-menu__header">',
      '    <div class="official-menu__brand">',
      '      <div class="official-menu__brand-mark">H</div>',
      '      <div class="official-menu__brand-copy">',
      '        <small>Rasmiy navigatsiya</small>',
      '        <strong>HALLAYM edu</strong>',
      '        <span>' + escapeHtml(doc.title || 'Platforma sahifasi') + '</span>',
      '      </div>',
      '    </div>',
      '    <button type="button" class="glass btn-ghost official-menu__close" data-menu-close aria-label="Yopish">',
      '      <i class="fa-solid fa-xmark"></i>',
      '    </button>',
      '  </div>',
      '  <div class="official-menu__body">',
           menuGroups.map(function (group) {
             return '<div class="official-menu__section">' +
               '<div class="official-menu__section-label">' + escapeHtml(group.label) + '</div>' +
               renderLinks(group.items) +
             '</div>';
           }).join(''),
      '  </div>',
      '  <div class="official-menu__footer">',
      '    <button type="button" class="official-menu__link" data-theme-proxy>',
      '      <i class="fa-solid fa-moon" data-theme-proxy-icon></i>',
      '      <span class="official-menu__link-copy">',
      '        <strong data-theme-proxy-label>Tungi rejim</strong>',
      '        <small>Rang sxemasini shu yerdan almashtiring</small>',
      '      </span>',
      '    </button>',
           renderLinks(footerLinks),
      '    <div class="official-menu__hint">ESC tugmasi bilan ham menyuni yopishingiz mumkin.</div>',
      '  </div>',
      '</div>'
    ].join('');

    return { overlay: overlay, panel: panel };
  }

  function syncThemeProxy(panel) {
    if (!panel) return;
    var icon = panel.querySelector('[data-theme-proxy-icon]');
    var label = panel.querySelector('[data-theme-proxy-label]');
    if (!icon || !label) return;
    var isDarkMode = root.classList.contains('dark');
    icon.className = isDarkMode ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    label.textContent = isDarkMode ? 'Kunduzgi rejim' : 'Tungi rejim';
  }

  function initMenu() {
    var btn = doc.getElementById('mobileMenuBtn');
    if (!btn || !doc.body) return;

    var ui = ensureMenu();
    var overlay = ui.overlay;
    var panel = ui.panel;
    var closeBtn = panel.querySelector('[data-menu-close]');
    var themeProxy = panel.querySelector('[data-theme-proxy]');
    var header = doc.querySelector('[data-official-topbar]');

    function openMenu() {
      overlay.classList.add('is-open');
      panel.classList.add('is-open');
      panel.setAttribute('aria-hidden', 'false');
      btn.setAttribute('aria-expanded', 'true');
      doc.body.style.overflow = 'hidden';
      syncThemeProxy(panel);
    }

    function closeMenu() {
      overlay.classList.remove('is-open');
      panel.classList.remove('is-open');
      panel.setAttribute('aria-hidden', 'true');
      btn.setAttribute('aria-expanded', 'false');
      doc.body.style.overflow = '';
    }

    function onScroll() {
      if (!header) return;
      header.classList.toggle('is-scrolled', (window.scrollY || window.pageYOffset || 0) > 18);
    }

    btn.addEventListener('click', function () {
      if (btn.getAttribute('aria-expanded') === 'true') closeMenu();
      else openMenu();
    });

    if (closeBtn) closeBtn.addEventListener('click', closeMenu);
    overlay.addEventListener('click', closeMenu);
    panel.addEventListener('click', function (event) {
      var link = event.target.closest('a');
      if (link) closeMenu();
    });

    if (themeProxy) {
      themeProxy.addEventListener('click', function () {
        var themeButton = doc.getElementById('themeToggle');
        if (themeButton) themeButton.click();
        syncThemeProxy(panel);
      });
    }

    doc.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
        closeMenu();
      }
    });

    if (header) {
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }

    if (window.MutationObserver) {
      var observer = new MutationObserver(function () {
        syncThemeProxy(panel);
      });
      observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    }

    syncThemeProxy(panel);
  }

  initMenu();
})();