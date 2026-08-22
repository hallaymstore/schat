(function () {
  function ensureFontAwesome() {
    const hasFa = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some((link) =>
      /font-awesome|fontawesome/i.test(link.href || '')
    );
    if (hasFa) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css';
    link.crossOrigin = 'anonymous';
    link.referrerPolicy = 'no-referrer';
    document.head.appendChild(link);
  }

  function normalizeText(text) {
    return (text || '')
      .replace(/[\u2018\u2019\u02bb`´]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hasPremiumIcon(el) {
    return !!el.querySelector('.premium-inline-icon, .fa-solid, .fa-regular, .fa-brands, svg');
  }

  function setIcon(el, iconClass, label, options) {
    if (!el || el.dataset.premiumIconized === 'true') return;

    const iconOnly = options && options.iconOnly;
    const srLabel = options && options.srLabel ? options.srLabel : label;
    el.dataset.premiumIconized = 'true';

    if (iconOnly) {
      el.innerHTML = '<i class="' + iconClass + ' premium-inline-icon" aria-hidden="true"></i>';
      if (srLabel) {
        el.setAttribute('aria-label', srLabel);
        el.title = srLabel;
      }
      return;
    }

    el.innerHTML =
      '<i class="' +
      iconClass +
      ' premium-inline-icon" aria-hidden="true"></i><span>' +
      label +
      '</span>';
  }

  const exactRules = [
    { text: 'Tema', icon: 'fa-regular fa-moon' },
    { text: 'Kurslar', icon: 'fa-solid fa-book-open' },
    { text: 'Testlar', icon: 'fa-solid fa-list-check' },
    { text: 'Sertifikat', icon: 'fa-solid fa-award' },
    { text: "Mini o'yinlar", icon: 'fa-solid fa-gamepad' },
    { text: 'Mini o‘yinlar', icon: 'fa-solid fa-gamepad' },
    { text: 'Xabarlar', icon: 'fa-regular fa-comments' },
    { text: 'Kanallar', icon: 'fa-solid fa-bullhorn' },
    { text: 'Guruhlar', icon: 'fa-solid fa-people-group' },
    { text: 'Profil', icon: 'fa-regular fa-user' },
    { text: 'Profile', icon: 'fa-regular fa-user' },
    { text: 'Dashboard', icon: 'fa-solid fa-table-cells-large' },
    { text: 'AI Slides', icon: 'fa-solid fa-wand-magic-sparkles' },
    { text: 'Search...', icon: 'fa-solid fa-magnifying-glass' },
    { text: 'Yangilash', icon: 'fa-solid fa-rotate-right' },
    { text: 'Chiqish', icon: 'fa-solid fa-right-from-bracket' },
    { text: 'Yopish', icon: 'fa-solid fa-xmark' },
    { text: 'Davomat', icon: 'fa-solid fa-clipboard-list' },
    { text: "Kursga qo'shish", icon: 'fa-solid fa-graduation-cap' },
    { text: "Kursga qo‘shish", icon: 'fa-solid fa-graduation-cap' },
    { text: 'Eligibility tekshirish', icon: 'fa-solid fa-circle-check' },
    { text: 'Sertifikat chizish', icon: 'fa-solid fa-pen-ruler' },
    { text: 'Tugatdim', icon: 'fa-solid fa-check' },
    { text: 'Guruh dars yozuvlari', icon: 'fa-solid fa-book-open' },
    { text: 'Orqaga', icon: 'fa-solid fa-arrow-left' },
    { text: 'Guruhlar', icon: 'fa-solid fa-arrow-left' }
  ];

  const containsRules = [
    { contains: 'Kurslar', icon: 'fa-solid fa-book-open', label: 'Kurslar' },
    { contains: 'Testlar', icon: 'fa-solid fa-list-check', label: 'Testlar' },
    { contains: 'Sertifikat', icon: 'fa-solid fa-award', label: 'Sertifikat' },
    { contains: 'Mini o', icon: 'fa-solid fa-gamepad', label: "Mini o'yinlar" },
    { contains: 'Xabarlar', icon: 'fa-regular fa-comments', label: 'Xabarlar' },
    { contains: 'Kanallar', icon: 'fa-solid fa-bullhorn', label: 'Kanallar' },
    { contains: 'Guruhlar', icon: 'fa-solid fa-people-group', label: 'Guruhlar' },
    { contains: 'Profil', icon: 'fa-regular fa-user', label: 'Profil' },
    { contains: 'Dashboard', icon: 'fa-solid fa-table-cells-large', label: 'Dashboard' },
    { contains: 'Search', icon: 'fa-solid fa-magnifying-glass', label: 'Search' },
    { contains: 'Yangilash', icon: 'fa-solid fa-rotate-right', label: 'Yangilash' },
    { contains: 'Davomat', icon: 'fa-solid fa-clipboard-list', label: 'Davomat' },
    { contains: 'Tugatdim', icon: 'fa-solid fa-check', label: 'Tugatdim' },
    { contains: 'Chiqish', icon: 'fa-solid fa-right-from-bracket', label: 'Chiqish' },
    { contains: 'Tema', icon: 'fa-regular fa-moon', label: 'Tema' },
    { contains: 'Guruh dars yozuvlari', icon: 'fa-solid fa-book-open', label: 'Guruh dars yozuvlari' }
  ];

  function applySpecialIds(root) {
    const map = [
      { selector: '#menuBtn, #mobileMenuBtn', icon: 'fa-solid fa-bars', iconOnly: true, label: 'Menyu' },
      { selector: '#drawerClose, #drawerCloseBtn, #mobileMenuClose, #spmClose', icon: 'fa-solid fa-xmark', iconOnly: true, label: 'Yopish' },
      { selector: '#themeBtn, #themeBtn2, #themeToggle, #themeToggle2', icon: 'fa-regular fa-moon', label: 'Tema' },
      { selector: '#logoutBtn, #logoutBtn2', icon: 'fa-solid fa-right-from-bracket', label: 'Chiqish' },
      { selector: '#refreshBtn', icon: 'fa-solid fa-rotate-right', label: 'Yangilash' }
    ];

    map.forEach((entry) => {
      root.querySelectorAll(entry.selector).forEach((el) => {
        if (hasPremiumIcon(el)) return;
        setIcon(el, entry.icon, entry.label, { iconOnly: !!entry.iconOnly, srLabel: entry.label });
      });
    });
  }

  function processElement(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.dataset && el.dataset.premiumIconized === 'true') return;
    const tag = (el.tagName || '').toLowerCase();
    const allowed =
      tag === 'button' ||
      tag === 'a' ||
      tag === 'h1' ||
      tag === 'h2' ||
      tag === 'h3' ||
      tag === 'summary' ||
      (el.classList && (el.classList.contains('font-bold') || el.classList.contains('font-extrabold')));

    if (!allowed || hasPremiumIcon(el)) return;

    const text = normalizeText(el.textContent);
    if (!text) return;
    const isHeading = /^h[1-3]$/.test(tag);

    for (const rule of exactRules) {
      if (text === rule.text) {
        setIcon(el, rule.icon, rule.text);
        return;
      }
    }

    if (isHeading) return;

    for (const rule of containsRules) {
      if (text.includes(rule.contains)) {
        setIcon(el, rule.icon, rule.label || text);
        return;
      }
    }
  }

  function scan(root) {
    applySpecialIds(root);
    root
      .querySelectorAll('button, a, h1, h2, h3, summary, .font-bold, .font-extrabold')
      .forEach(processElement);
  }

  function start() {
    ensureFontAwesome();
    scan(document);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches('button, a, h1, h2, h3, summary, .font-bold, .font-extrabold')) {
            processElement(node);
          }
          if (node.querySelectorAll) {
            scan(node);
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
