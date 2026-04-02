(function () {
  const TOKEN_KEY = 'token';
  const THEME_KEY = 'theme';
  const state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    settings: null,
    premium: null,
    user: null,
    sessions: []
  };

  const els = {
    dashboardLink: document.getElementById('dashboardLink'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    heroStats: document.getElementById('heroStats'),
    profileCard: document.getElementById('profileCard'),
    premiumCard: document.getElementById('premiumCard'),
    notificationToggleList: document.getElementById('notificationToggleList'),
    sessionsList: document.getElementById('sessionsList'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    settingsForm: document.getElementById('settingsForm'),
    passwordForm: document.getElementById('passwordForm'),
    revokeOthersBtn: document.getElementById('revokeOthersBtn'),
    languageInput: document.getElementById('languageInput'),
    themeInput: document.getElementById('themeInput'),
    profileVisibilityInput: document.getElementById('profileVisibilityInput'),
    animatedStickersInput: document.getElementById('animatedStickersInput'),
    stickerAutoplayInput: document.getElementById('stickerAutoplayInput'),
    compactModeInput: document.getElementById('compactModeInput'),
    soundEnabledInput: document.getElementById('soundEnabledInput'),
    showEmailInput: document.getElementById('showEmailInput'),
    showPhoneInput: document.getElementById('showPhoneInput'),
    currentPasswordInput: document.getElementById('currentPasswordInput'),
    nextPasswordInput: document.getElementById('nextPasswordInput'),
    confirmPasswordInput: document.getElementById('confirmPasswordInput'),
    toast: document.getElementById('toast')
  };

  const notificationItems = [
    ['directMessages', 'Direct messages', 'Shaxsiy chat va javoblar'],
    ['courseUpdates', 'Course updates', 'Kurs, test, material va natijalar'],
    ['liveClasses', 'Live classes', 'Jonli dars va call eslatmalari'],
    ['aiProducts', 'AI products', 'Slide va website studio yangiliklari'],
    ['billing', 'Billing', 'Premium va to‘lov so‘rovlari'],
    ['marketing', 'Marketing', 'Kampaniya va mahsulot yangiliklari']
  ];

  function showToast(message, type) {
    if (!message || !els.toast) return;
    els.toast.textContent = message;
    els.toast.className = `toast ${type || ''}`.trim();
    els.toast.classList.remove('hidden');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => els.toast.classList.add('hidden'), 3600);
  }

  function dashboardPath(role) {
    const safe = String(role || '').trim().toLowerCase();
    if (safe === 'teacher') return '/teacher-dashboard.html';
    if (safe === 'admin') return '/admin-dashboard.html';
    if (safe === 'organizer') return '/organizer.html';
    return '/student-dashboard.html';
  }

  function applyTheme(mode) {
    const next = String(mode || 'system');
    if (next === 'dark') {
      document.documentElement.classList.add('dark');
    } else if (next === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.toggle('dark', !!prefersDark);
    }
    localStorage.setItem(THEME_KEY, next);
    if (els.themeToggleBtn) {
      const dark = document.documentElement.classList.contains('dark');
      els.themeToggleBtn.innerHTML = dark
        ? '<i class="fa-solid fa-sun"></i> Kunduzgi'
        : '<i class="fa-solid fa-moon"></i> Tungi';
    }
  }

  async function api(path, options) {
    if (!state.token) {
      window.location.href = '/login.html?next=' + encodeURIComponent('/settings-center.html');
      throw new Error('Authentication required');
    }
    const headers = Object.assign({}, options && options.headers || {}, {
      Authorization: `Bearer ${state.token}`
    });
    if (options && options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(path, Object.assign({}, options || {}, { headers }));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem(TOKEN_KEY);
        window.location.href = '/login.html?next=' + encodeURIComponent('/settings-center.html');
      }
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
  }

  function renderHeroStats() {
    const premium = state.premium || {};
    const userPlan = premium.userPlan || {};
    const institutionPlan = premium.institutionPlan || {};
    els.heroStats.innerHTML = [
      { label: 'AI credits', value: String(Number(userPlan.aiCreditsRemaining || 0)), note: `${Number(userPlan.aiCreditsUsed || 0)} ishlatilgan` },
      { label: 'User premium', value: premium.active && premium.active.user ? (userPlan.label || 'Faol') : 'Yoq', note: premium.active && premium.active.user ? `Tugash: ${formatDate(userPlan.expiresAt)}` : 'Website va slides premium orqali ochiladi' },
      { label: 'Institution', value: premium.active && premium.active.institution ? (institutionPlan.label || 'Faol') : 'Yoq', note: premium.active && premium.active.institution ? `${Number(institutionPlan.seatLimit || 0)} ta user limiti` : '250 / 500 / 1000 user planlari' }
    ].map((item) => `
      <div class="stat-card">
        <div class="stat-label">${escapeHtml(item.label)}</div>
        <div class="stat-value">${escapeHtml(item.value)}</div>
        <div class="stat-note">${escapeHtml(item.note)}</div>
      </div>
    `).join('');
  }

  function renderProfileCard() {
    const user = state.user || {};
    els.profileCard.innerHTML = `
      <div class="list-line">
        <div>
          <div class="list-title">${window.HallaymPremiumUi ? window.HallaymPremiumUi.renderNameWithBadges(user, { fallback: 'Profil' }) : escapeHtml(user.fullName || user.username || 'Profil')}</div>
          <div class="list-meta">@${escapeHtml(user.username || '')} · ${escapeHtml(user.role || 'student')}</div>
        </div>
        <div class="status-pill ${user.verified ? 'approved' : 'pending'}">${user.verified ? 'Verified' : 'Standart'}</div>
      </div>
      <div class="list-actions">
        <span class="info-badge"><i class="fa-solid fa-building-columns"></i> ${escapeHtml(user.university || 'Universitet')}</span>
        <span class="info-badge"><i class="fa-solid fa-users"></i> ${escapeHtml(user.studyGroup || 'Guruh')}</span>
      </div>
    `;
  }

  function renderPremiumCard() {
    const premium = state.premium || {};
    const userPlan = premium.userPlan || {};
    const institutionPlan = premium.institutionPlan || {};
    const userStatus = premium.active && premium.active.user;
    const institutionStatus = premium.active && premium.active.institution;
    els.premiumCard.innerHTML = `
      <div class="list-line">
        <div>
          <div class="list-title">Premium holati</div>
          <div class="list-meta">${userStatus ? `${escapeHtml(userPlan.label || 'User premium')} faol` : 'User premium faol emas'}</div>
        </div>
        <a class="primary-btn" href="/payment.html"><i class="fa-solid fa-crown"></i> Manage</a>
      </div>
      <div class="badge-strip" style="margin-top:12px">
        <span class="status-pill ${userStatus ? 'approved' : 'pending'}">${userStatus ? 'User premium active' : 'User premium off'}</span>
        <span class="status-pill ${institutionStatus ? 'approved' : 'pending'}">${institutionStatus ? 'Campus plan active' : 'Campus plan off'}</span>
      </div>
      <div class="list-meta" style="margin-top:12px">
        ${userStatus ? `AI credits: ${Number(userPlan.aiCreditsRemaining || 0)} / ${Number(userPlan.aiCreditsLimit || 0)}` : 'AI Slides va Website Studio premium orqali ochiladi.'}
      </div>
      <div class="list-meta" style="margin-top:6px">
        ${institutionStatus ? `Institution plan: ${escapeHtml(institutionPlan.label || '')} · ${Number(institutionPlan.seatLimit || 0)} user` : 'Universitet uchun 250, 500 va 1000 user planlari mavjud.'}
      </div>
    `;
  }

  function renderNotificationToggles() {
    const notifications = (state.settings && state.settings.notifications) || {};
    els.notificationToggleList.innerHTML = notificationItems.map(([key, title, note]) => `
      <label class="switch-row">
        <span class="switch-copy">
          <span class="switch-title">${escapeHtml(title)}</span>
          <span class="switch-note">${escapeHtml(note)}</span>
        </span>
        <input class="toggle" type="checkbox" data-notification-key="${escapeHtml(key)}" ${notifications[key] ? 'checked' : ''}/>
      </label>
    `).join('');
  }

  function renderSessions() {
    if (!Array.isArray(state.sessions) || !state.sessions.length) {
      els.sessionsList.innerHTML = '<div class="empty-state">Faol session topilmadi.</div>';
      return;
    }
    els.sessionsList.innerHTML = state.sessions.map((session) => `
      <div class="list-card">
        <div class="list-line">
          <div>
            <div class="list-title">${escapeHtml(session.deviceName || session.browser || 'Qurilma')}</div>
            <div class="list-meta">${escapeHtml([session.os, session.browser].filter(Boolean).join(' · ') || 'Noma’lum qurilma')}</div>
          </div>
          <div class="status-pill ${session.isCurrent ? 'approved' : 'pending'}">${session.isCurrent ? 'Joriy' : 'Faol'}</div>
        </div>
        <div class="list-meta" style="margin-top:10px">${escapeHtml(session.locationLabel || session.ip || 'Joylashuv topilmadi')} · ${escapeHtml(formatDate(session.lastSeenAt || session.lastActiveAt || session.createdAt))}</div>
        <div class="list-actions">
          ${session.isCurrent ? '' : `<button class="ghost-btn" type="button" data-revoke-session="${escapeHtml(session.id || '')}"><i class="fa-solid fa-user-slash"></i> Chiqazish</button>`}
        </div>
      </div>
    `).join('');
    els.sessionsList.querySelectorAll('[data-revoke-session]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await api(`/api/security/sessions/${encodeURIComponent(button.getAttribute('data-revoke-session') || '')}/revoke`, { method: 'POST' });
          showToast('Session chiqarildi', 'success');
          await loadSessions();
        } catch (error) {
          showToast(error.message || 'Session chiqarilmadi', 'error');
        }
      });
    });
  }

  function fillSettingsForm() {
    const settings = state.settings || {};
    const privacy = settings.privacy || {};
    els.languageInput.value = settings.language || 'uz';
    els.themeInput.value = settings.theme || 'system';
    els.profileVisibilityInput.value = privacy.profileVisibility || 'campus';
    els.animatedStickersInput.checked = !!settings.animatedStickers;
    els.stickerAutoplayInput.checked = !!settings.stickerAutoplay;
    els.compactModeInput.checked = !!settings.compactMode;
    els.soundEnabledInput.checked = !!settings.soundEnabled;
    els.showEmailInput.checked = !!privacy.showEmail;
    els.showPhoneInput.checked = !!privacy.showPhone;
  }

  function formatDate(value) {
    if (!value) return '—';
    try {
      return new Intl.DateTimeFormat('uz-UZ', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date(value));
    } catch (_) {
      return '—';
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function loadSettings() {
    const data = await api('/api/settings');
    state.settings = data.settings || {};
    state.premium = data.premium || {};
    state.user = data.user || {};
    els.dashboardLink.href = dashboardPath(state.user.role);
    fillSettingsForm();
    renderHeroStats();
    renderProfileCard();
    renderPremiumCard();
    renderNotificationToggles();
  }

  async function loadSessions() {
    const data = await api('/api/security/sessions');
    state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
    renderSessions();
  }

  function collectSettingsPayload() {
    const current = state.settings || {};
    const currentNotifications = current.notifications || {};
    const payload = {
      language: els.languageInput.value,
      theme: els.themeInput.value,
      animatedStickers: els.animatedStickersInput.checked,
      stickerAutoplay: els.stickerAutoplayInput.checked,
      compactMode: els.compactModeInput.checked,
      soundEnabled: els.soundEnabledInput.checked,
      notifications: {},
      privacy: {
        profileVisibility: els.profileVisibilityInput.value,
        showEmail: els.showEmailInput.checked,
        showPhone: els.showPhoneInput.checked
      }
    };
    notificationItems.forEach(([key]) => {
      const toggle = els.notificationToggleList.querySelector(`[data-notification-key="${key}"]`);
      payload.notifications[key] = toggle ? !!toggle.checked : !!currentNotifications[key];
    });
    return payload;
  }

  async function saveSettings() {
    try {
      els.saveSettingsBtn.disabled = true;
      const data = await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(collectSettingsPayload())
      });
      state.settings = data.settings || state.settings;
      state.premium = data.premium || state.premium;
      localStorage.setItem(THEME_KEY, state.settings.theme || 'system');
      applyTheme(state.settings.theme || 'system');
      renderHeroStats();
      renderPremiumCard();
      showToast('Sozlamalar saqlandi', 'success');
    } catch (error) {
      showToast(error.message || 'Sozlamalar saqlanmadi', 'error');
    } finally {
      els.saveSettingsBtn.disabled = false;
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    const currentPassword = els.currentPasswordInput.value.trim();
    const newPassword = els.nextPasswordInput.value.trim();
    const confirm = els.confirmPasswordInput.value.trim();
    if (!currentPassword || !newPassword) return showToast('Parollarni to‘liq kiriting', 'error');
    if (newPassword.length < 6) return showToast('Yangi parol kamida 6 belgidan iborat bo‘lsin', 'error');
    if (newPassword !== confirm) return showToast('Yangi parol tasdiqlash bilan mos emas', 'error');
    try {
      await api('/api/security/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword,
          newPassword
        })
      });
      els.passwordForm.reset();
      showToast('Parol yangilandi', 'success');
      await loadSessions();
    } catch (error) {
      showToast(error.message || 'Parol yangilanmadi', 'error');
    }
  }

  async function revokeOthers() {
    try {
      await api('/api/security/sessions/revoke-others', { method: 'POST' });
      showToast('Boshqa sessionlar chiqarildi', 'success');
      await loadSessions();
    } catch (error) {
      showToast(error.message || 'Sessionlar chiqarilmadi', 'error');
    }
  }

  function bindEvents() {
    els.themeToggleBtn.addEventListener('click', () => {
      const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
      applyTheme(next);
      if (state.settings) state.settings.theme = next;
    });
    els.saveSettingsBtn.addEventListener('click', saveSettings);
    els.passwordForm.addEventListener('submit', changePassword);
    els.revokeOthersBtn.addEventListener('click', revokeOthers);
  }

  async function init() {
    applyTheme(localStorage.getItem(THEME_KEY) || 'system');
    bindEvents();
    await Promise.all([loadSettings(), loadSessions()]);
  }

  init().catch((error) => {
    showToast(error.message || 'Settings Center yuklanmadi', 'error');
  });
})();
