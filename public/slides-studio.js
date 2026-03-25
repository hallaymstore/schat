(function () {
  const TOKEN_KEY = 'token';
  const THEME_KEY = 'theme';
  const DEFAULT_THEMES = [
    { id: 'auto', label: 'AI tanlaydi', mood: 'Mavzuga qarab eng mos uslubni tanlaydi.' },
    { id: 'teal-minimal', label: 'Teal Minimal', mood: 'Oq fon, rasmiy va juda toza korinish.' },
    { id: 'executive-white', label: 'Executive White', mood: 'Formal, boardroom uslubi, minimal chiziqlar.' },
    { id: 'midnight-teal', label: 'Midnight Teal', mood: 'Qora fon va och teal aksentlar.' },
    { id: 'blueprint-grid', label: 'Blueprint Grid', mood: 'Akademik, texnik va gridga tayangan dizayn.' },
    { id: 'editorial-warm', label: 'Editorial Warm', mood: 'Storytelling va jurnalsimon yumshoq dizayn.' },
    { id: 'campus-card', label: 'Campus Card', mood: 'Talabalar uchun qulay, kartali va zamonaviy.' }
  ];
  const SLIDE_TEXT = {
    uz: {
      agendaHint: 'Ushbu qismni qisqa va aniq tushuntiring.',
      splitLeftTitle: 'Asosiy nuqtalar',
      splitRightTitle: 'Davomi',
      splitBodyHint: 'Mazmunni chap tarafda qisqa blok bilan tushuntiring.',
      splitAsideHint: 'Qisqa dalillar, misollar yoki keyingi qadamlar shu yerda turadi.',
      themeDeckLabel: 'HALLAYM AI deck',
      deckSummaryFallback: 'HALLAYM Slide Studio bu deckni presentation-ready ko‘rinishda tayyorladi.',
      visualLabel: 'Vizual',
      nextStep: 'Keyingi qadam',
      speakerFallback: 'Bu slide uchun alohida speaker note kelmagan. Sarlavha va punktlar bo‘yicha qisqa izoh bering.',
      sourceLabel: 'Manbalar',
      slideWord: 'Slide'
    },
    en: {
      agendaHint: 'Explain this section briefly and clearly.',
      splitLeftTitle: 'Key points',
      splitRightTitle: 'More detail',
      splitBodyHint: 'Explain the idea in a short block on the left.',
      splitAsideHint: 'Put concise facts, examples, or next actions here.',
      themeDeckLabel: 'HALLAYM AI deck',
      deckSummaryFallback: 'HALLAYM Slide Studio prepared this deck in a presentation-ready format.',
      visualLabel: 'Visual',
      nextStep: 'Next step',
      speakerFallback: 'No separate speaker note was returned for this slide. Briefly explain the title and key points.',
      sourceLabel: 'Sources',
      slideWord: 'Slide'
    },
    ru: {
      agendaHint: 'Кратко и понятно объясните этот раздел.',
      splitLeftTitle: 'Ключевые пункты',
      splitRightTitle: 'Детали',
      splitBodyHint: 'Кратко объясните идею в левом блоке.',
      splitAsideHint: 'Здесь разместите короткие факты, примеры или дальнейшие шаги.',
      themeDeckLabel: 'deck HALLAYM AI',
      deckSummaryFallback: 'HALLAYM Slide Studio подготовила этот deck в удобном для показа формате.',
      visualLabel: 'Визуал',
      nextStep: 'Следующий шаг',
      speakerFallback: 'Для этого слайда отдельная заметка не пришла. Коротко объясните заголовок и ключевые пункты.',
      sourceLabel: 'Источники',
      slideWord: 'Слайд'
    }
  };

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    me: null,
    themes: DEFAULT_THEMES.slice(),
    selectedStyle: 'auto',
    decks: [],
    currentDeck: null,
    currentIndex: 0,
    autoplayTimer: null,
    toastTimer: null,
    isPresenting: false,
    freshAutoDone: false,
    qs: new URLSearchParams(window.location.search)
  };

  const els = {
    welcomeUserLine: document.getElementById('welcomeUserLine'),
    dashboardLink: document.getElementById('dashboardLink'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    welcomeNote: document.getElementById('welcomeNote'),
    generatorForm: document.getElementById('generatorForm'),
    promptInput: document.getElementById('promptInput'),
    audienceInput: document.getElementById('audienceInput'),
    languageInput: document.getElementById('languageInput'),
    slideCountInput: document.getElementById('slideCountInput'),
    slideCountValue: document.getElementById('slideCountValue'),
    styleGrid: document.getElementById('styleGrid'),
    demoDeckBtn: document.getElementById('demoDeckBtn'),
    resetPromptBtn: document.getElementById('resetPromptBtn'),
    refreshHistoryBtn: document.getElementById('refreshHistoryBtn'),
    generateBtn: document.getElementById('generateBtn'),
    historyList: document.getElementById('historyList'),
    deckTitle: document.getElementById('deckTitle'),
    deckSubtitle: document.getElementById('deckSubtitle'),
    deckMetaRow: document.getElementById('deckMetaRow'),
    previewSlot: document.getElementById('previewSlot'),
    slideIndicator: document.getElementById('slideIndicator'),
    prevSlideBtn: document.getElementById('prevSlideBtn'),
    nextSlideBtn: document.getElementById('nextSlideBtn'),
    thumbTrack: document.getElementById('thumbTrack'),
    speakerNote: document.getElementById('speakerNote'),
    sourcesWrap: document.getElementById('sourcesWrap'),
    copyOutlineBtn: document.getElementById('copyOutlineBtn'),
    downloadPdfBtn: document.getElementById('downloadPdfBtn'),
    downloadPptxBtn: document.getElementById('downloadPptxBtn'),
    autoplayBtn: document.getElementById('autoplayBtn'),
    presentBtn: document.getElementById('presentBtn'),
    deleteDeckBtn: document.getElementById('deleteDeckBtn'),
    presentOverlay: document.getElementById('presentOverlay'),
    presentDeckTitle: document.getElementById('presentDeckTitle'),
    presentDeckMeta: document.getElementById('presentDeckMeta'),
    presentSlideSlot: document.getElementById('presentSlideSlot'),
    presentPrevBtn: document.getElementById('presentPrevBtn'),
    presentNextBtn: document.getElementById('presentNextBtn'),
    presentCloseBtn: document.getElementById('presentCloseBtn'),
    toast: document.getElementById('toast')
  };

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeCopy(value) {
    return String(value || '')
      .replace(/вЂў/g, '|')
      .replace(/вЂ™/g, "'")
      .replace(/вЂ/g, "'");
  }

  function deckLanguage(deck) {
    const value = String(deck && deck.language || '').trim().toLowerCase();
    if (value === 'en') return 'en';
    if (value === 'ru') return 'ru';
    return 'uz';
  }

  function slideText(deck) {
    return SLIDE_TEXT[deckLanguage(deck)] || SLIDE_TEXT.uz;
  }

  function safeCssUrl(value) {
    return encodeURI(String(value || '').trim())
      .replace(/'/g, '%27')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29');
  }

  function safeDownloadBaseName(value) {
    return String(value || 'hallaym-slide-deck')
      .replace(/[<>:"/\\|?*\x00-\x1F]+/g, ' ')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'hallaym-slide-deck';
  }

  function deepClone(value) {
    return value ? JSON.parse(JSON.stringify(value)) : value;
  }

  function isRemoteHttpUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return false;
    try {
      const parsed = new URL(raw, window.location.origin);
      return /^https?:$/i.test(parsed.protocol) && parsed.origin !== window.location.origin;
    } catch (_) {
      return false;
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  }

  async function fetchExportAssetDataUrl(url) {
    const raw = String(url || '').trim();
    if (!raw || !isRemoteHttpUrl(raw)) return raw;
    const response = await fetch(`/api/slides/export-asset?url=${encodeURIComponent(raw)}`, {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Export asset yuklanmadi');
    }
    const blob = await response.blob();
    return blobToDataUrl(blob);
  }

  async function buildExportDeckSnapshot(deck) {
    const cloned = deepClone(deck) || {};
    const remoteUrls = Array.from(new Set(
      []
        .concat(String(cloned.heroImageUrl || '').trim() ? [String(cloned.heroImageUrl || '').trim()] : [])
        .concat(Array.isArray(cloned.slides) ? cloned.slides.map((slide) => String(slide && slide.imageUrl || '').trim()) : [])
        .filter((url) => isRemoteHttpUrl(url))
    ));
    if (!remoteUrls.length) return cloned;

    const assetMap = new Map();
    await Promise.all(remoteUrls.map(async (url) => {
      try {
        assetMap.set(url, await fetchExportAssetDataUrl(url));
      } catch (_) {
        assetMap.set(url, url);
      }
    }));

    if (assetMap.has(cloned.heroImageUrl)) cloned.heroImageUrl = assetMap.get(cloned.heroImageUrl) || cloned.heroImageUrl;
    if (Array.isArray(cloned.slides)) {
      cloned.slides = cloned.slides.map((slide) => {
        const next = Object.assign({}, slide);
        if (assetMap.has(next.imageUrl)) next.imageUrl = assetMap.get(next.imageUrl) || next.imageUrl;
        return next;
      });
    }
    return cloned;
  }

  function waitForFrames(count) {
    let remaining = Math.max(1, Number(count || 1));
    return new Promise((resolve) => {
      const step = () => {
        remaining -= 1;
        if (remaining <= 0) return resolve();
        return window.requestAnimationFrame(step);
      };
      window.requestAnimationFrame(step);
    });
  }

  function preloadImage(url) {
    return new Promise((resolve) => {
      const src = String(url || '').trim();
      if (!src) return resolve();
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = src;
    });
  }

  async function warmDeckImages(deck, slides) {
    const urls = Array.from(new Set(
      []
        .concat(String(deck && deck.heroImageUrl || '').trim() ? [String(deck.heroImageUrl).trim()] : [])
        .concat(Array.isArray(slides) ? slides.map((slide) => slideImageUrl(deck, slide)) : [])
        .filter(Boolean)
    ));
    await Promise.all(urls.map((url) => preloadImage(url)));
    if (document.fonts && document.fonts.ready) {
      await Promise.race([
        document.fonts.ready.catch(() => null),
        new Promise((resolve) => window.setTimeout(resolve, 1400))
      ]);
    }
    await waitForFrames(2);
  }

  function normalizeSourceLinks(list) {
    if (!Array.isArray(list)) return [];
    return Array.from(new Set(list.map((item) => String(item || '').trim()).filter(Boolean))).slice(0, 3);
  }

  function slideDensityClass(slide) {
    const bullets = []
      .concat(Array.isArray(slide && slide.bullets) ? slide.bullets : [])
      .concat(Array.isArray(slide && slide.leftBullets) ? slide.leftBullets : [])
      .concat(Array.isArray(slide && slide.rightBullets) ? slide.rightBullets : []);
    const timeline = Array.isArray(slide && slide.timeline) ? slide.timeline : [];
    const stats = Array.isArray(slide && slide.stats) ? slide.stats : [];
    const score = Math.ceil(String(slide && slide.title || '').length / 20)
      + Math.ceil(String(slide && slide.subtitle || '').length / 34)
      + Math.ceil(String(slide && slide.body || '').length / 55)
      + Math.ceil(String(slide && slide.quote || '').length / 70)
      + bullets.length
      + (timeline.length * 2)
      + stats.length;
    if (score >= 16) return 'dense';
    if (score >= 11) return 'compact';
    return '';
  }

  function slideImageUrl(deck, slide) {
    return String(slide && slide.imageUrl || ((slide && slide.layout) === 'cover' ? (deck && deck.heroImageUrl || '') : '') || '').trim();
  }

  function showToast(message, type) {
    if (!message) return;
    clearTimeout(state.toastTimer);
    els.toast.textContent = message;
    els.toast.className = `toast ${type || ''}`.trim();
    els.toast.classList.remove('hidden');
    state.toastTimer = window.setTimeout(() => {
      els.toast.classList.add('hidden');
    }, 3400);
  }

  function setButtonLoading(btn, loading, html) {
    if (!btn) return;
    btn.classList.toggle('is-loading', !!loading);
    btn.disabled = !!loading;
    if (html) btn.innerHTML = html;
  }

  function normalizeNextPath(raw) {
    const value = String(raw || '').trim();
    if (!value.startsWith('/')) return '';
    if (value.startsWith('//')) return '';
    return value;
  }

  function dashboardPathForRole(role) {
    const normalized = String(role || '').toLowerCase();
    if (normalized === 'teacher') return '/teacher-dashboard.html';
    if (normalized === 'admin') return '/admin-dashboard.html';
    if (normalized === 'organizer') return '/organizer.html';
    return '/student-dashboard.html';
  }

  function formatDate(value) {
    try {
      return new Intl.DateTimeFormat('uz-UZ', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(value));
    } catch (_) {
      return '';
    }
  }

  function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.classList.contains('dark');
    const next = isDark ? 'light' : 'dark';
    html.classList.toggle('dark', next === 'dark');
    localStorage.setItem(THEME_KEY, next);
    syncThemeButton();
  }

  function syncThemeButton() {
    const isDark = document.documentElement.classList.contains('dark');
    els.themeToggleBtn.innerHTML = isDark
      ? '<i class="fa-solid fa-sun"></i> Kunduzgi'
      : '<i class="fa-solid fa-moon"></i> Tungi';
  }

  async function api(path, options) {
    const headers = Object.assign({}, options && options.headers || {});
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    if (!headers['Content-Type'] && options && options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(path, Object.assign({}, options || {}, { headers }));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem(TOKEN_KEY);
        window.location.href = '/login.html?next=' + encodeURIComponent('/slides.html');
      }
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
  }

  function mergeThemePresets(list) {
    if (!Array.isArray(list) || !list.length) return;
    const map = new Map(DEFAULT_THEMES.map((item) => [item.id, Object.assign({}, item)]));
    list.forEach((item) => {
      const id = String(item && item.id || '').trim();
      if (!id) return;
      map.set(id, { id, label: String(item.label || id), mood: String(item.mood || '') });
    });
    state.themes = [{ id: 'auto', label: 'AI tanlaydi', mood: 'Mavzuga qarab eng mos uslubni tanlaydi.' }]
      .concat(Array.from(map.values()).filter((item) => item.id !== 'auto'));
  }

  function deckSummary(deck) {
    return {
      _id: deck && deck._id || '',
      title: deck && deck.title || 'Yangi deck',
      subtitle: deck && deck.subtitle || '',
      summary: deck && deck.summary || '',
      themeId: deck && deck.themeId || 'teal-minimal',
      themeLabel: deck && deck.themeLabel || 'Teal Minimal',
      slideCount: Number(deck && deck.slideCount || (deck && deck.slides && deck.slides.length) || 0),
      generationMode: deck && deck.generationMode || 'ai',
      createdAt: deck && deck.createdAt || new Date().toISOString(),
      aiProvider: deck && deck.aiProvider || 'hallaym-ai'
    };
  }

  function renderStyleGrid() {
    els.styleGrid.innerHTML = state.themes.map((theme) => {
      const active = state.selectedStyle === theme.id ? ' active' : '';
      return `
        <button class="style-card${active}" type="button" data-style-id="${escapeHtml(theme.id)}">
          <strong>${escapeHtml(theme.label)}</strong>
          <span>${escapeHtml(theme.mood || 'Premium va sodda korinish.')}</span>
        </button>
      `;
    }).join('');
    els.styleGrid.querySelectorAll('[data-style-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedStyle = btn.getAttribute('data-style-id') || 'auto';
        renderStyleGrid();
      });
    });
  }

  function renderHistory() {
    if (!state.decks.length) {
      els.historyList.innerHTML = '<div class="empty-state" style="min-height:180px;">Hozircha deck yo\'q. Birinchi taqdimotingizni tayyorlab ko\'ring.</div>';
      return;
    }
    const currentId = String(state.currentDeck && state.currentDeck._id || '');
    els.historyList.innerHTML = state.decks.map((deck) => {
      const active = currentId && currentId === String(deck._id || '') ? ' active' : '';
      return `
        <div class="history-card${active}" data-open-deck="${escapeHtml(deck._id)}">
          <div class="history-top">
            <div style="min-width:0;">
              <strong>${escapeHtml(deck.title || 'Yangi deck')}</strong>
              <span>${escapeHtml(deck.subtitle || deck.summary || 'HALLAYM AI deck')}</span>
            </div>
            <button class="history-delete" type="button" data-delete-deck="${escapeHtml(deck._id)}" aria-label="Delete deck">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
          <div class="history-meta">
            <span>${escapeHtml(deck.themeLabel || deck.themeId || 'Theme')}</span>
            <span>${escapeHtml(String(deck.slideCount || 0))} slide</span>
          </div>
          <div class="history-meta">
            <span>${escapeHtml(deck.generationMode || 'ai')}</span>
            <span>${escapeHtml(formatDate(deck.createdAt))}</span>
          </div>
        </div>
      `;
    }).join('');
    els.historyList.querySelectorAll('[data-open-deck]').forEach((card) => {
      card.addEventListener('click', async (event) => {
        if (event.target.closest('[data-delete-deck]')) return;
        const deckId = card.getAttribute('data-open-deck');
        if (!deckId) return;
        await openDeck(deckId, true);
      });
    });
    els.historyList.querySelectorAll('[data-delete-deck]').forEach((btn) => {
      btn.addEventListener('click', async (event) => {
        event.stopPropagation();
        const deckId = btn.getAttribute('data-delete-deck');
        if (!deckId) return;
        await deleteDeck(deckId);
      });
    });
  }

  function renderDeckMeta(deck) {
    const slideCount = Number(deck && deck.slideCount || (deck && deck.slides && deck.slides.length) || 0);
    const created = deck && deck.createdAt ? formatDate(deck.createdAt) : '';
    const mode = String(deck && deck.generationMode || 'ai');
    const sourceCount = Array.isArray(deck && deck.sourceLinks) ? deck.sourceLinks.length : 0;
    els.deckMetaRow.innerHTML = `
      <span class="deck-chip"><i class="fa-solid fa-palette"></i> ${escapeHtml(deck && deck.themeLabel || deck && deck.themeId || 'Theme')}</span>
      <span class="deck-chip"><i class="fa-solid fa-layer-group"></i> ${escapeHtml(String(slideCount))} slide</span>
      <span class="deck-chip"><i class="fa-solid fa-robot"></i> HALLAYM AI</span>
      <span class="deck-chip"><i class="fa-solid fa-sparkles"></i> ${escapeHtml(mode)}</span>
      ${sourceCount ? `<span class="deck-chip"><i class="fa-solid fa-globe"></i> ${escapeHtml(String(sourceCount))} manba</span>` : ''}
      ${created ? `<span class="deck-chip"><i class="fa-solid fa-clock"></i> ${escapeHtml(created)}</span>` : ''}
    `;
  }

  function buildPointList(list) {
    if (!Array.isArray(list) || !list.length) return '';
    return `<ul class="point-list">${list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  }

  function buildChipList(list) {
    if (!Array.isArray(list) || !list.length) return '';
    return `<div class="chip-list">${list.slice(0, 4).map((item) => `<div class="chip-item">${escapeHtml(item)}</div>`).join('')}</div>`;
  }

  function buildAgendaList(list, deck) {
    const copy = slideText(deck);
    if (!Array.isArray(list) || !list.length) return '';
    return `<div class="agenda-grid">${list.map((item, index) => `
      <div class="agenda-item">
        <span class="agenda-index">${index + 1}</span>
        <div class="agenda-copy">
          <strong>${escapeHtml(item)}</strong>
          <span>${escapeHtml(copy.agendaHint)}</span>
        </div>
      </div>
    `).join('')}</div>`;
  }

  function buildTimeline(list, deck) {
    const copy = slideText(deck);
    if (!Array.isArray(list) || !list.length) return '';
    return `<div class="timeline-list">${list.map((item, index) => `
      <div class="timeline-item">
        <span class="timeline-index">${index + 1}</span>
        <div class="timeline-copy">
          <strong>${escapeHtml(item.title || `${copy.slideWord} ${index + 1}`)}</strong>
          <span>${escapeHtml(item.detail || '')}</span>
        </div>
      </div>
    `).join('')}</div>`;
  }

  function buildStats(list) {
    if (!Array.isArray(list) || !list.length) return '';
    return `<div class="metric-grid">${list.map((item) => `
      <div class="stat-card">
        <strong>${escapeHtml(item.value || '')}</strong>
        <span>${escapeHtml(item.label || '')}</span>
      </div>
    `).join('')}</div>`;
  }

  function buildMediaCard(deck, slide, options) {
    const imageUrl = slideImageUrl(deck, slide);
    if (!imageUrl) return '';
    const copy = slideText(deck);
    const className = String(options && options.className || '').trim();
    const title = String(options && options.title || slide && slide.imageCaption || slide && slide.title || copy.visualLabel).trim();
    const caption = String(options && options.caption || slide && slide.subtitle || deck && deck.summary || '').trim();
    return `
      <div class="surface-card media-panel${className ? ` ${className}` : ''}">
        <div class="media-visual" style="background-image:url('${safeCssUrl(imageUrl)}')"></div>
        <div class="media-copy">
          <strong>${escapeHtml(title || copy.visualLabel)}</strong>
          ${caption ? `<span>${escapeHtml(caption)}</span>` : ''}
        </div>
      </div>
    `;
  }

  function renderSlideMarkup(deck, slide, index) {
    const copy = slideText(deck);
    const themeId = String(deck && deck.themeId || 'teal-minimal');
    const title = escapeHtml(slide && slide.title || `${copy.slideWord} ${index + 1}`);
    const subtitle = escapeHtml(slide && slide.subtitle || deck && deck.subtitle || '');
    const kicker = escapeHtml(slide && slide.kicker || deck && deck.themeLabel || copy.slideWord);
    const body = escapeHtml(slide && slide.body || '');
    const callout = slide && slide.callout ? `<div class="callout-box">${escapeHtml(slide.callout)}</div>` : '';
    const watermark = escapeHtml(normalizeCopy(deck && deck.watermark || ''));
    const layout = String(slide && slide.layout || 'content');
    const density = slideDensityClass(slide);
    const countText = `${index + 1} / ${(deck && deck.slides && deck.slides.length) || 0}`;
    const topLine = `
      <div class="slide-topline">
        <span>${escapeHtml(deck && deck.themeLabel || deck && deck.themeId || 'Slide Studio')}</span>
        <span>${countText}</span>
      </div>
    `;
    let content = '';

    if (layout === 'cover') {
      content = `
        <div class="slide-body">
          <span class="slide-kicker">${kicker}</span>
          <div class="cover-grid">
            <div class="slide-col-stack">
              <h3 class="slide-title">${title}</h3>
              ${subtitle ? `<p class="slide-subtitle">${subtitle}</p>` : ''}
              ${body ? `<p class="slide-paragraph">${body}</p>` : ''}
              ${buildChipList(slide && slide.bullets || [])}
              ${callout}
            </div>
            <div class="slide-col-stack">
              ${buildMediaCard(deck, slide, {
                className: 'media-hero',
                title: slide && slide.imageCaption || slide && slide.title || copy.visualLabel,
                caption: slide && slide.subtitle || deck && deck.summary || copy.deckSummaryFallback
              })}
              <div class="surface-card mini-note">
                <strong>${escapeHtml(deck && deck.themeLabel || copy.themeDeckLabel)}</strong>
                <span>${escapeHtml(deck && deck.summary || copy.deckSummaryFallback)}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    } else if (layout === 'agenda') {
      const mediaCard = buildMediaCard(deck, slide, {
        className: 'media-sm',
        title: slide && slide.imageCaption || copy.visualLabel,
        caption: slide && slide.callout || deck && deck.summary || ''
      });
      content = `
        <div class="slide-body">
          <span class="slide-kicker">${kicker}</span>
          <div class="agenda-shell${mediaCard ? '' : ' single'}">
            <div class="slide-col-stack">
              <h3 class="slide-title medium">${title}</h3>
              ${subtitle ? `<p class="slide-subtitle">${subtitle}</p>` : ''}
              ${buildAgendaList(slide && slide.bullets || [], deck)}
              ${callout}
            </div>
            ${mediaCard ? `<div class="slide-col-stack">${mediaCard}</div>` : ''}
          </div>
        </div>
      `;
    } else if (layout === 'split') {
      const leftTitle = escapeHtml(slide && slide.leftTitle || copy.splitLeftTitle);
      const rightTitle = escapeHtml(slide && slide.rightTitle || copy.splitRightTitle);
      const leftBullets = Array.isArray(slide && slide.leftBullets) ? slide.leftBullets : [];
      const rightBullets = Array.isArray(slide && slide.rightBullets) ? slide.rightBullets : [];
      const mediaCard = buildMediaCard(deck, slide, {
        className: 'media-sm',
        title: slide && slide.imageCaption || slide && slide.title || copy.visualLabel,
        caption: slide && slide.subtitle || ''
      });
      const asideCard = (rightBullets.length || (slide && slide.callout)) ? `
        <div class="surface-card">
          <strong>${rightTitle}</strong>
          <span>${escapeHtml(slide && slide.callout || copy.splitAsideHint)}</span>
          ${buildPointList(rightBullets.length ? rightBullets : (slide && slide.bullets || []))}
        </div>
      ` : '';
      content = `
        <div class="slide-body">
          <span class="slide-kicker">${kicker}</span>
          <h3 class="slide-title medium">${title}</h3>
          ${subtitle ? `<p class="slide-subtitle">${subtitle}</p>` : ''}
          <div class="split-grid${(!leftBullets.length && !rightBullets.length && !mediaCard) ? ' single' : ''}">
            <div class="surface-card">
              <strong>${leftTitle}</strong>
              <span>${body || escapeHtml(copy.splitBodyHint)}</span>
              ${buildPointList(leftBullets.length ? leftBullets : (slide && slide.bullets || []))}
            </div>
            ${(asideCard || mediaCard) ? `<div class="slide-col-stack">${mediaCard}${asideCard}</div>` : ''}
          </div>
        </div>
      `;
    } else if (layout === 'quote') {
      const mediaCard = buildMediaCard(deck, slide, {
        className: 'media-sm',
        title: slide && slide.imageCaption || copy.visualLabel,
        caption: slide && slide.quoteAuthor || ''
      });
      content = `
        <div class="slide-body">
          <div class="quote-shell${mediaCard ? '' : ' single'}">
            <div class="quote-block">
              <span class="quote-mark">"</span>
              <p class="quote-text">${escapeHtml(slide && slide.quote || slide && slide.title || '')}</p>
              ${slide && slide.quoteAuthor ? `<p class="quote-author">${escapeHtml(slide.quoteAuthor)}</p>` : ''}
              ${callout}
            </div>
            ${mediaCard ? `<div class="slide-col-stack">${mediaCard}</div>` : ''}
          </div>
        </div>
      `;
    } else if (layout === 'timeline') {
      const mediaCard = buildMediaCard(deck, slide, {
        className: 'media-sm',
        title: slide && slide.imageCaption || copy.visualLabel,
        caption: slide && slide.callout || ''
      });
      content = `
        <div class="slide-body">
          <span class="slide-kicker">${kicker}</span>
          <div class="timeline-grid${mediaCard ? '' : ' single'}">
            <div class="slide-col-stack">
              <h3 class="slide-title medium">${title}</h3>
              ${subtitle ? `<p class="slide-subtitle">${subtitle}</p>` : ''}
              ${buildTimeline(slide && slide.timeline || [], deck) || buildPointList(slide && slide.bullets || [])}
              ${callout}
            </div>
            ${mediaCard ? `<div class="slide-col-stack">${mediaCard}</div>` : ''}
          </div>
        </div>
      `;
    } else if (layout === 'metrics') {
      const mediaCard = buildMediaCard(deck, slide, {
        className: 'media-sm',
        title: slide && slide.imageCaption || copy.visualLabel,
        caption: slide && slide.subtitle || ''
      });
      content = `
        <div class="slide-body">
          <span class="slide-kicker">${kicker}</span>
          <div class="metrics-shell${mediaCard ? '' : ' single'}">
            <div class="slide-col-stack">
              <h3 class="slide-title medium">${title}</h3>
              ${subtitle ? `<p class="slide-subtitle">${subtitle}</p>` : ''}
              ${buildStats(slide && slide.stats || []) || buildChipList(slide && slide.bullets || [])}
              ${body ? `<p class="slide-paragraph">${body}</p>` : ''}
              ${callout}
            </div>
            ${mediaCard ? `<div class="slide-col-stack">${mediaCard}</div>` : ''}
          </div>
        </div>
      `;
    } else if (layout === 'closing') {
      const mediaCard = buildMediaCard(deck, slide, {
        className: 'media-sm',
        title: slide && slide.imageCaption || copy.visualLabel,
        caption: slide && slide.subtitle || deck && deck.summary || ''
      });
      content = `
        <div class="slide-body">
          <span class="slide-kicker">${kicker}</span>
          <div class="closing-grid">
            <div class="slide-col-stack">
              <h3 class="slide-title">${title}</h3>
              ${subtitle ? `<p class="slide-subtitle">${subtitle}</p>` : ''}
              ${body ? `<p class="slide-paragraph">${body}</p>` : ''}
              ${buildPointList(slide && slide.bullets || [])}
            </div>
            <div class="slide-col-stack">
              ${mediaCard}
              <div class="surface-card">
                <strong>${escapeHtml(copy.nextStep)}</strong>
                <span>${escapeHtml(slide && slide.callout || copy.splitAsideHint)}</span>
                <div class="callout-box">${escapeHtml(deck && deck.watermark || '')}</div>
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      const bullets = Array.isArray(slide && slide.bullets) ? slide.bullets : [];
      const mediaCard = buildMediaCard(deck, slide, {
        className: 'media-sm',
        title: slide && slide.imageCaption || copy.visualLabel,
        caption: slide && slide.subtitle || deck && deck.summary || ''
      });
      content = `
        <div class="slide-body">
          <span class="slide-kicker">${kicker}</span>
          <div class="content-grid${bullets.length || mediaCard ? '' : ' single'}">
            <div class="slide-col-stack">
              <h3 class="slide-title medium">${title}</h3>
              ${subtitle ? `<p class="slide-subtitle">${subtitle}</p>` : ''}
              ${body ? `<p class="slide-paragraph">${body}</p>` : ''}
              ${callout}
            </div>
            ${(bullets.length || mediaCard) ? `
              <div class="slide-col-stack">
                ${bullets.length ? `<div class="surface-card">${buildPointList(bullets)}</div>` : ''}
                ${mediaCard}
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }

    return `
      <div class="slide-canvas${density ? ` ${density}` : ''}" data-theme="${escapeHtml(themeId)}" data-layout="${escapeHtml(layout)}">
        <div class="slide-shell">
          ${topLine}
          ${content}
          <div class="slide-footer">
            <span>${watermark || '<strong>by HALLAYM</strong>'}</span>
            <strong>${countText}</strong>
          </div>
        </div>
      </div>
    `;
  }

  function renderSources(deck, slide) {
    const copy = slideText(deck);
    const slideLinks = normalizeSourceLinks(slide && slide.sourceLinks || []);
    const deckLinks = normalizeSourceLinks(deck && deck.sourceLinks || []).filter((link) => !slideLinks.includes(link));
    const links = slideLinks.concat(deckLinks).slice(0, 6);
    if (!links.length) {
      els.sourcesWrap.innerHTML = '';
      return;
    }
    els.sourcesWrap.innerHTML = `
      <p class="section-kicker" style="margin-top:4px;">${escapeHtml(copy.sourceLabel)}</p>
      ${links.map((link, index) => `
        <a class="source-link" href="${escapeHtml(link)}" target="_blank" rel="noreferrer noopener">
          <i class="fa-solid fa-link"></i>
          <span>${escapeHtml(`${copy.sourceLabel} ${index + 1}: ${link}`)}</span>
        </a>
      `).join('')}
    `;
  }

  function renderEmpty(message) {
    els.previewSlot.className = 'empty-state';
    els.previewSlot.innerHTML = escapeHtml(message);
    els.thumbTrack.innerHTML = '';
    els.slideIndicator.textContent = '0 / 0';
    els.speakerNote.textContent = 'Hozircha speaker note yo\'q.';
    els.sourcesWrap.innerHTML = '';
    els.deckMetaRow.innerHTML = '';
  }

  function renderDeck() {
    const deck = state.currentDeck;
    if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) {
      els.deckTitle.textContent = 'Slide Studio tayyor';
      els.deckSubtitle.textContent = 'Deck tanlang yoki yangi taqdimot tayyorlang. Slidelar sodda, rasmiy va tushunarli qilib chiqariladi.';
      renderEmpty('HALLAYM AI deck shu yerda ko\'rinadi. Chap tomondan mavzuni kiriting yoki tarixdan deck tanlang.');
      return;
    }
    if (state.currentIndex >= deck.slides.length) state.currentIndex = deck.slides.length - 1;
    if (state.currentIndex < 0) state.currentIndex = 0;
    const slide = deck.slides[state.currentIndex];
    const copy = slideText(deck);
    els.deckTitle.textContent = deck.title || 'Yangi deck';
    els.deckSubtitle.textContent = deck.subtitle || deck.summary || 'AI taqdimot decki';
    renderDeckMeta(deck);
    renderSources(deck, slide);
    els.previewSlot.className = 'slide-stage';
    els.previewSlot.innerHTML = renderSlideMarkup(deck, slide, state.currentIndex);
    els.slideIndicator.textContent = `${state.currentIndex + 1} / ${deck.slides.length}`;
    els.speakerNote.textContent = slide.speakerNote || copy.speakerFallback;
    els.thumbTrack.innerHTML = deck.slides.map((item, index) => {
      const active = index === state.currentIndex ? ' active' : '';
      return `
        <button class="thumb-card${active}" type="button" data-slide-index="${index}">
          <strong>${escapeHtml(item.title || `Slide ${index + 1}`)}</strong>
          <span>${escapeHtml(item.kicker || item.layout || 'Slide')}</span>
          <div class="thumb-meta">
            <span>${escapeHtml(item.layout || 'content')}</span>
            <span>${index + 1}</span>
          </div>
        </button>
      `;
    }).join('');
    els.thumbTrack.querySelectorAll('[data-slide-index]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.currentIndex = Number(btn.getAttribute('data-slide-index') || 0);
        renderDeck();
      });
    });
    if (state.isPresenting) {
      els.presentDeckTitle.textContent = deck.title || 'Taqdimot';
      els.presentDeckMeta.textContent = `${deck.themeLabel || deck.themeId || 'Slide Studio'} | ${state.currentIndex + 1} / ${deck.slides.length}`;
      els.presentSlideSlot.innerHTML = renderSlideMarkup(deck, slide, state.currentIndex);
    }
  }

  async function loadHistory() {
    const result = await api('/api/slides?limit=24');
    mergeThemePresets(result.themePresets);
    renderStyleGrid();
    state.decks = Array.isArray(result.decks) ? result.decks : [];
    renderHistory();
    if (!state.currentDeck && state.decks.length) {
      await openDeck(state.decks[0]._id, false);
    }
  }

  async function openDeck(deckId, withToast) {
    if (!deckId) return;
    const result = await api(`/api/slides/${encodeURIComponent(deckId)}`);
    state.currentDeck = result.deck || null;
    state.currentIndex = 0;
    renderHistory();
    renderDeck();
    if (withToast) showToast('Deck ochildi.', 'success');
  }

  async function deleteDeck(deckId) {
    if (!deckId) return;
    if (!window.confirm('Ushbu deckni ochirib tashlaysizmi?')) return;
    await api(`/api/slides/${encodeURIComponent(deckId)}`, { method: 'DELETE' });
    state.decks = state.decks.filter((item) => String(item._id) !== String(deckId));
    if (state.currentDeck && String(state.currentDeck._id) === String(deckId)) {
      state.currentDeck = null;
      state.currentIndex = 0;
    }
    renderHistory();
    if (!state.currentDeck && state.decks.length) await openDeck(state.decks[0]._id, false);
    else renderDeck();
    showToast('Deck ochirildi.', 'success');
  }

  function buildWelcomePrompt() {
    const user = state.me || {};
    const role = String(user.role || 'student').toLowerCase();
    const roleLabel = role === 'teacher' ? 'oqituvchi' : (role === 'admin' ? 'platforma boshqaruvi' : (role === 'organizer' ? 'tashkilotchi' : 'talaba'));
    const uni = user.university ? ` ${user.university} uchun` : '';
    return `${roleLabel}${uni} HALLAYM Slide Studio tanishtiruv taqdimoti`;
  }

  function defaultAudience() {
    const role = String(state.me && state.me.role || 'student').toLowerCase();
    if (role === 'teacher') return 'Teacherlar va talabalar';
    if (role === 'admin') return 'Platforma jamoasi va foydalanuvchilar';
    if (role === 'organizer') return 'Tadbir qatnashchilari';
    return 'Talabalar va boshlovchilar';
  }

  async function generateDeck(autoPrompt) {
    const prompt = els.promptInput.value.trim();
    const audience = els.audienceInput.value.trim();
    const language = els.languageInput.value;
    const slideCount = Number(els.slideCountInput.value || 6);
    if (!prompt) {
      showToast('Avval mavzuni yozing.', 'error');
      els.promptInput.focus();
      return;
    }
    const original = els.generateBtn.innerHTML;
    setButtonLoading(els.generateBtn, true, '<i class="fa-solid fa-spinner fa-spin"></i> Tayyorlanmoqda...');
    els.previewSlot.className = 'loading-state';
      els.previewSlot.textContent = autoPrompt ? 'Yangi foydalanuvchi uchun demo deck tayyorlanmoqda...' : 'HALLAYM AI slidelarni tayyorlayapti...';
    try {
      const result = await api('/api/slides/generate', {
        method: 'POST',
        body: JSON.stringify({
          prompt,
          audience,
          language,
          slideCount,
          styleRequested: state.selectedStyle
        })
      });
      mergeThemePresets(result.themePresets);
      renderStyleGrid();
      const deck = result.deck || null;
      if (!deck) throw new Error('Deck empty');
      state.currentDeck = deck;
      state.currentIndex = 0;
      state.decks = [deckSummary(deck)].concat(state.decks.filter((item) => String(item._id) !== String(deck._id)));
      renderHistory();
      renderDeck();
      showToast(autoPrompt ? 'Demo deck tayyorlandi.' : 'HALLAYM AI deck tayyor.', 'success');
    } catch (error) {
      renderDeck();
      showToast(error.message || 'Deck tayyorlab bolmadi.', 'error');
    } finally {
      setButtonLoading(els.generateBtn, false, original);
    }
  }

  function outlineText(deck) {
    if (!deck || !Array.isArray(deck.slides)) return '';
    return [
      deck.title || 'Presentation',
      deck.subtitle || '',
      ''
    ].concat(deck.slides.map((slide, index) => {
      const lines = [`${index + 1}. ${slide.title || `Slide ${index + 1}`}`];
      if (slide.subtitle) lines.push(`   ${slide.subtitle}`);
      if (slide.body) lines.push(`   ${slide.body}`);
      const group = []
        .concat(Array.isArray(slide.bullets) ? slide.bullets : [])
        .concat(Array.isArray(slide.leftBullets) ? slide.leftBullets : [])
        .concat(Array.isArray(slide.rightBullets) ? slide.rightBullets : []);
      group.slice(0, 6).forEach((item) => lines.push(`   - ${item}`));
      if (Array.isArray(slide.stats)) slide.stats.forEach((item) => lines.push(`   - ${item.label}: ${item.value}`));
      if (Array.isArray(slide.timeline)) slide.timeline.forEach((item) => lines.push(`   - ${item.title}: ${item.detail}`));
      if (slide.quote) lines.push(`   - Quote: ${slide.quote}`);
      return lines.join('\n');
    })).join('\n');
  }

  async function copyOutline() {
    if (!state.currentDeck) {
      showToast('Avval deck oching.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(outlineText(state.currentDeck));
      showToast('Outline nusxalandi.', 'success');
    } catch (_) {
      showToast('Clipboard ga yozib bolmadi.', 'error');
    }
  }

  function downloadBlob(blob, fileName) {
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  async function captureDeckSlideImages(deck, onProgress) {
    if (!window.html2canvas) {
      throw new Error('html2canvas yuklanmagan');
    }
    const exportDeck = await buildExportDeckSnapshot(deck);
    const slides = Array.isArray(exportDeck && exportDeck.slides) ? exportDeck.slides : [];
    if (!slides.length) {
      throw new Error('Export uchun slide topilmadi');
    }
    await warmDeckImages(exportDeck, slides);

    const sandbox = document.createElement('div');
    sandbox.style.position = 'fixed';
    sandbox.style.left = '-20000px';
    sandbox.style.top = '0';
    sandbox.style.width = '1600px';
    sandbox.style.padding = '0';
    sandbox.style.zIndex = '-1';
    sandbox.style.pointerEvents = 'none';
    sandbox.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sandbox);

    try {
      const images = [];
      for (let index = 0; index < slides.length; index += 1) {
        if (typeof onProgress === 'function') onProgress(index, slides.length);
        sandbox.innerHTML = `<div class="slide-stage">${renderSlideMarkup(exportDeck, slides[index], index)}</div>`;
        const stage = sandbox.firstElementChild;
        const canvasEl = stage && stage.querySelector('.slide-canvas');
        if (!stage || !canvasEl) throw new Error('Slide render topilmadi');

        stage.style.padding = '0';
        stage.style.border = '0';
        stage.style.background = 'transparent';
        stage.style.boxShadow = 'none';
        canvasEl.style.width = '1600px';
        canvasEl.style.height = '900px';
        canvasEl.style.maxHeight = 'none';

        await warmDeckImages(exportDeck, [slides[index]]);
        const canvas = await window.html2canvas(canvasEl, {
          backgroundColor: null,
          useCORS: true,
          allowTaint: false,
          scale: 2,
          logging: false,
          width: 1600,
          height: 900,
          windowWidth: 1600,
          windowHeight: 900
        });
        images.push(canvas.toDataURL('image/png', 1));
        sandbox.innerHTML = '';
      }
      if (typeof onProgress === 'function') onProgress(slides.length, slides.length);
      return images;
    } finally {
      sandbox.remove();
    }
  }

  async function downloadDeckFromPreview(format, btn) {
    const safeTitle = safeDownloadBaseName(state.currentDeck && state.currentDeck.title);
    const slideImages = await captureDeckSlideImages(state.currentDeck, (index, total) => {
      if (!btn || !total) return;
      const current = Math.min(index + 1, total);
      btn.innerHTML = format === 'pdf'
        ? `<i class="fa-solid fa-spinner fa-spin"></i> PDF ${current}/${total}`
        : `<i class="fa-solid fa-spinner fa-spin"></i> PPTX ${current}/${total}`;
    });

    if (format === 'pdf') {
      const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
      if (!jsPDFCtor) throw new Error('jsPDF yuklanmagan');
      const pdf = new jsPDFCtor({
        orientation: 'landscape',
        unit: 'pt',
        format: [960, 540],
        compress: true
      });
      slideImages.forEach((dataUri, index) => {
        if (index > 0) pdf.addPage([960, 540], 'landscape');
        pdf.addImage(dataUri, 'PNG', 0, 0, 960, 540, undefined, 'FAST');
      });
      pdf.save(`${safeTitle}.pdf`);
      return;
    }

    const PptxCtor = window.PptxGenJS || window.pptxgen || (window.pptxgenjs && window.pptxgenjs.PptxGenJS);
    if (!PptxCtor || typeof PptxCtor !== 'function') {
      throw new Error('PPTX generator yuklanmagan');
    }
    const pptx = new PptxCtor();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'HALLAYM AI';
    pptx.company = 'HALLAYM';
    pptx.subject = String(state.currentDeck && state.currentDeck.title || '').trim();
    pptx.title = String(state.currentDeck && state.currentDeck.title || '').trim();
    pptx.lang = deckLanguage(state.currentDeck);
    slideImages.forEach((dataUri) => {
      const slide = pptx.addSlide();
      slide.addImage({
        data: dataUri,
        x: 0,
        y: 0,
        w: 13.333,
        h: 7.5
      });
    });
    await pptx.writeFile({ fileName: `${safeTitle}.pptx` });
  }

  async function downloadDeckFromServer(format) {
    const response = await fetch(`/api/slides/${encodeURIComponent(state.currentDeck._id)}/export.${format}`, {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Export failed (${response.status})`);
    }
    const blob = await response.blob();
    downloadBlob(blob, `${safeDownloadBaseName(state.currentDeck.title)}.${format}`);
  }

  async function downloadDeck(format) {
    if (!state.currentDeck || !state.currentDeck._id) {
      showToast('Avval deck tayyorlang.', 'error');
      return;
    }
    const btn = format === 'pdf' ? els.downloadPdfBtn : els.downloadPptxBtn;
    const original = btn.innerHTML;
    setButtonLoading(btn, true, format === 'pdf'
      ? '<i class="fa-solid fa-spinner fa-spin"></i> PDF...'
      : '<i class="fa-solid fa-spinner fa-spin"></i> PPTX...');
    try {
      try {
        await downloadDeckFromPreview(format, btn);
      } catch (previewError) {
        console.error(`Preview export failed for ${format}:`, previewError);
        btn.innerHTML = format === 'pdf'
          ? '<i class="fa-solid fa-spinner fa-spin"></i> PDF server export...'
          : '<i class="fa-solid fa-spinner fa-spin"></i> PPTX server export...';
        await downloadDeckFromServer(format);
      }
      showToast(format === 'pdf' ? 'PDF yuklab olindi.' : 'PPTX yuklab olindi.', 'success');
    } catch (error) {
      showToast(error.message || 'Yuklab olib bo\'lmadi.', 'error');
    } finally {
      setButtonLoading(btn, false, original);
    }
  }

  function toggleAutoplay() {
    if (!state.currentDeck || !state.currentDeck.slides || !state.currentDeck.slides.length) {
      showToast('Auto play uchun deck kerak.', 'error');
      return;
    }
    if (state.autoplayTimer) {
      clearInterval(state.autoplayTimer);
      state.autoplayTimer = null;
      els.autoplayBtn.innerHTML = '<i class="fa-solid fa-play"></i> Auto play';
      showToast('Auto play toxtatildi.');
      return;
    }
    state.autoplayTimer = window.setInterval(() => {
      const total = state.currentDeck && state.currentDeck.slides ? state.currentDeck.slides.length : 0;
      if (!total) return;
      state.currentIndex = (state.currentIndex + 1) % total;
      renderDeck();
    }, 5000);
    els.autoplayBtn.innerHTML = '<i class="fa-solid fa-pause"></i> Stop';
    showToast('Auto play ishga tushdi.', 'success');
  }

  function enterPresentMode() {
    if (!state.currentDeck || !state.currentDeck.slides || !state.currentDeck.slides.length) {
      showToast('Avval deck tayyorlang.', 'error');
      return;
    }
    state.isPresenting = true;
    els.presentOverlay.hidden = false;
    renderDeck();
    if (els.presentOverlay.requestFullscreen) els.presentOverlay.requestFullscreen().catch(() => {});
  }

  function exitPresentMode() {
    state.isPresenting = false;
    els.presentOverlay.hidden = true;
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }

  function moveSlide(step) {
    if (!state.currentDeck || !Array.isArray(state.currentDeck.slides) || !state.currentDeck.slides.length) return;
    const total = state.currentDeck.slides.length;
    state.currentIndex = (state.currentIndex + step + total) % total;
    renderDeck();
  }

  async function logout() {
    try {
      if (state.token) {
        await fetch('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${state.token}` } }).catch(() => null);
      }
    } finally {
      localStorage.removeItem(TOKEN_KEY);
      window.location.href = '/login.html';
    }
  }

  async function maybeAutoGenerateFreshDeck() {
    const wantsWelcome = state.qs.get('welcome') === '1';
    const wantsFresh = state.qs.get('fresh') === '1';
    if (!wantsWelcome) return;
    const userName = String(state.me && (state.me.fullName || state.me.username) || 'foydalanuvchi');
    els.welcomeNote.classList.remove('hidden');
    els.welcomeNote.innerHTML = `
      <strong>${escapeHtml(userName)}, Slide Studio tayyor.</strong>
      <span>Royxatdan keyin foydalanuvchini faollashtirish uchun shu yerning ozida AI demo deck ham tayyorlab bera olamiz. Kerak bolsa keyin shu sahifadan cheksiz yangi decklar yasaysiz.</span>
    `;
    if (!wantsFresh || state.freshAutoDone || state.decks.length) return;
    state.freshAutoDone = true;
    if (!els.promptInput.value.trim()) els.promptInput.value = buildWelcomePrompt();
    if (!els.audienceInput.value.trim()) els.audienceInput.value = defaultAudience();
    state.selectedStyle = 'campus-card';
    renderStyleGrid();
    await generateDeck(true);
  }

  async function loadProfile() {
    if (!state.token) {
      window.location.href = '/login.html?next=' + encodeURIComponent('/slides.html');
      return;
    }
    const me = await api('/api/me');
    state.me = me && (me.user || me) || {};
    const fullName = state.me.fullName || state.me.fullname || state.me.username || 'foydalanuvchi';
    const nextPath = normalizeNextPath(state.qs.get('next')) || dashboardPathForRole(state.me.role);
    els.welcomeUserLine.textContent = `${fullName} uchun AI taqdimot maydoni tayyor. Watermark avtomatik qoshiladi.`;
    els.dashboardLink.href = nextPath;
    if (!els.audienceInput.value.trim()) els.audienceInput.value = defaultAudience();
  }

  function bindEvents() {
    els.themeToggleBtn.addEventListener('click', toggleTheme);
    els.logoutBtn.addEventListener('click', logout);
    els.slideCountInput.addEventListener('input', () => { els.slideCountValue.textContent = els.slideCountInput.value; });
    els.generatorForm.addEventListener('submit', async (event) => { event.preventDefault(); await generateDeck(false); });
    els.demoDeckBtn.addEventListener('click', async () => {
      els.promptInput.value = buildWelcomePrompt();
      els.audienceInput.value = defaultAudience();
      if (!state.selectedStyle || state.selectedStyle === 'auto') {
        state.selectedStyle = 'campus-card';
        renderStyleGrid();
      }
      await generateDeck(true);
    });
    els.resetPromptBtn.addEventListener('click', () => {
      els.promptInput.value = '';
      els.audienceInput.value = defaultAudience();
      els.languageInput.value = 'uz';
      els.slideCountInput.value = '6';
      els.slideCountValue.textContent = '6';
      state.selectedStyle = 'auto';
      renderStyleGrid();
    });
    els.refreshHistoryBtn.addEventListener('click', async () => { await loadHistory(); showToast('Tarix yangilandi.'); });
    els.prevSlideBtn.addEventListener('click', () => moveSlide(-1));
    els.nextSlideBtn.addEventListener('click', () => moveSlide(1));
    els.presentPrevBtn.addEventListener('click', () => moveSlide(-1));
    els.presentNextBtn.addEventListener('click', () => moveSlide(1));
    els.presentCloseBtn.addEventListener('click', exitPresentMode);
    els.copyOutlineBtn.addEventListener('click', copyOutline);
    els.downloadPdfBtn.addEventListener('click', async () => { await downloadDeck('pdf'); });
    els.downloadPptxBtn.addEventListener('click', async () => { await downloadDeck('pptx'); });
    els.autoplayBtn.addEventListener('click', toggleAutoplay);
    els.presentBtn.addEventListener('click', enterPresentMode);
    els.deleteDeckBtn.addEventListener('click', async () => {
      if (!state.currentDeck || !state.currentDeck._id) return showToast('Ochiriladigan deck tanlanmagan.', 'error');
      await deleteDeck(state.currentDeck._id);
    });
    document.addEventListener('keydown', (event) => {
      const activeTag = String(document.activeElement && document.activeElement.tagName || '').toUpperCase();
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;
      if (event.key === 'ArrowRight') moveSlide(1);
      if (event.key === 'ArrowLeft') moveSlide(-1);
      if (event.key === 'Escape' && state.isPresenting) exitPresentMode();
    });
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && state.isPresenting) {
        state.isPresenting = false;
        els.presentOverlay.hidden = true;
      }
    });
  }

  async function init() {
    syncThemeButton();
    renderStyleGrid();
    bindEvents();
    renderDeck();
    await loadProfile();
    await loadHistory();
    await maybeAutoGenerateFreshDeck();
  }

  init().catch((error) => {
    console.error('slides init error:', error);
    showToast(error.message || 'Slide Studio yuklanmadi.', 'error');
  });
})();
