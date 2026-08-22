(function () {
  const TOKEN_KEY = 'token';
  const THEME_KEY = 'theme';
  const state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    me: null,
    plans: { user: [], university: [] },
    premium: null,
    paymentMethod: null,
    requests: [],
    billingCycle: 'monthly',
    selectedScope: 'user',
    selectedPlanId: '',
    selectedPlan: null
  };

  const els = {
    dashboardLink: document.getElementById('dashboardLink'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    billingSwitch: document.getElementById('billingSwitch'),
    focusUserBtn: document.getElementById('focusUserBtn'),
    focusCampusBtn: document.getElementById('focusCampusBtn'),
    premiumStats: document.getElementById('premiumStats'),
    paymentCard: document.getElementById('paymentCard'),
    currentPremiumCard: document.getElementById('currentPremiumCard'),
    userPlans: document.getElementById('userPlans'),
    campusPlans: document.getElementById('campusPlans'),
    paymentForm: document.getElementById('paymentForm'),
    selectedScopeInput: document.getElementById('selectedScopeInput'),
    selectedPlanInput: document.getElementById('selectedPlanInput'),
    selectedCycleInput: document.getElementById('selectedCycleInput'),
    selectedPriceInput: document.getElementById('selectedPriceInput'),
    paymentNoteInput: document.getElementById('paymentNoteInput'),
    paymentScreenshotInput: document.getElementById('paymentScreenshotInput'),
    submitPaymentBtn: document.getElementById('submitPaymentBtn'),
    paymentHistory: document.getElementById('paymentHistory'),
    toast: document.getElementById('toast')
  };

  function showToast(message, type) {
    if (!message) return;
    els.toast.textContent = message;
    els.toast.className = `toast ${type || ''}`.trim();
    els.toast.classList.remove('hidden');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => els.toast.classList.add('hidden'), 3600);
  }

  function applyTheme(mode) {
    const next = String(mode || 'system');
    if (next === 'dark') document.documentElement.classList.add('dark');
    else if (next === 'light') document.documentElement.classList.remove('dark');
    else {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.toggle('dark', prefersDark);
    }
    localStorage.setItem(THEME_KEY, next);
    const dark = document.documentElement.classList.contains('dark');
    els.themeToggleBtn.innerHTML = dark
      ? '<i class="fa-solid fa-sun"></i> Kunduzgi'
      : '<i class="fa-solid fa-moon"></i> Tungi';
  }

  function dashboardPath(role) {
    const safe = String(role || '').trim().toLowerCase();
    if (safe === 'teacher') return '/teacher-dashboard.html';
    if (safe === 'admin') return '/admin-dashboard.html';
    if (safe === 'rector') return '/rector-dashboard.html';
    if (safe === 'prorector') return '/prorector-dashboard.html';
    if (safe === 'dean') return '/dean-dashboard.html';
    if (safe === 'organizer') return '/organizer.html';
    return '/student-dashboard.html';
  }

  async function api(path, options) {
    if (!state.token) {
      window.location.href = '/login.html?next=' + encodeURIComponent('/payment.html');
      throw new Error('Authentication required');
    }
    const headers = Object.assign({}, options && options.headers || {}, {
      Authorization: `Bearer ${state.token}`
    });
    const response = await fetch(path, Object.assign({}, options || {}, { headers }));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem(TOKEN_KEY);
        window.location.href = '/login.html?next=' + encodeURIComponent('/payment.html');
      }
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatMoney(value) {
    const amount = Number(value || 0);
    return `${amount.toLocaleString('uz-UZ')} so‘m`;
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

  function findPlan(scope, planId) {
    return (state.plans[scope] || []).find((item) => String(item.id || '') === String(planId || '')) || null;
  }

  function syncSelectedPlan() {
    const fallback = (state.plans[state.selectedScope] || [])[0] || null;
    const selected = findPlan(state.selectedScope, state.selectedPlanId) || fallback;
    state.selectedPlan = selected;
    state.selectedPlanId = selected ? selected.id : '';
    els.selectedScopeInput.value = state.selectedScope === 'user' ? 'User premium' : 'Campus plan';
    els.selectedPlanInput.value = selected ? selected.label : 'Tarif tanlanmagan';
    els.selectedCycleInput.value = state.billingCycle === 'yearly' ? 'Yillik' : 'Oylik';
    els.selectedPriceInput.value = selected ? formatMoney(state.billingCycle === 'yearly' ? selected.yearlyPrice : selected.monthlyPrice) : '—';
  }

  function renderStats() {
    const premium = state.premium || {};
    const userPlan = premium.userPlan || {};
    const institutionPlan = premium.institutionPlan || {};
    els.premiumStats.innerHTML = [
      { label: 'AI credits', value: String(Number(userPlan.aiCreditsRemaining || 0)), note: `Limit: ${Number(userPlan.aiCreditsLimit || 0)}` },
      { label: 'User plan', value: premium.active && premium.active.user ? (userPlan.label || 'Faol') : 'Standart', note: premium.active && premium.active.user ? `Tugash: ${formatDate(userPlan.expiresAt)}` : 'Verified badge + stickers premiumda' },
      { label: 'Campus plan', value: premium.active && premium.active.institution ? (institutionPlan.label || 'Faol') : 'Mavjud emas', note: premium.active && premium.active.institution ? `${Number(institutionPlan.seatLimit || 0)} ta user` : '250 / 500 / 1000 user' }
    ].map((item) => `
      <div class="stat-card">
        <div class="stat-label">${escapeHtml(item.label)}</div>
        <div class="stat-value">${escapeHtml(item.value)}</div>
        <div class="stat-note">${escapeHtml(item.note)}</div>
      </div>
    `).join('');
  }

  function renderPaymentCard() {
    const payment = state.paymentMethod || {};
    els.paymentCard.innerHTML = `
      <small>Qabul qiluvchi</small>
      <div style="font-size:22px;font-weight:900;margin-top:8px">${escapeHtml(payment.holder || 'HALLAYM EDU')}</div>
      <small style="margin-top:14px">Karta raqami</small>
      <strong>${escapeHtml(payment.cardNumber || '8600 0000 0000 0000')}</strong>
      <small style="margin-top:14px">${escapeHtml(payment.bankNote || 'To‘lovdan keyin screenshot yuklang.')}</small>
    `;
  }

  function renderCurrentPremiumCard() {
    const premium = state.premium || {};
    const activeUser = premium.active && premium.active.user;
    const activeInstitution = premium.active && premium.active.institution;
    els.currentPremiumCard.innerHTML = `
      <div class="list-title">Joriy holat</div>
      <div class="badge-strip" style="margin-top:12px">
        <span class="status-pill ${activeUser ? 'approved' : 'pending'}">${activeUser ? 'User premium active' : 'User premium off'}</span>
        <span class="status-pill ${activeInstitution ? 'approved' : 'pending'}">${activeInstitution ? 'Campus plan active' : 'Campus plan off'}</span>
      </div>
      <div class="list-meta" style="margin-top:12px">${activeUser ? `${escapeHtml(premium.userPlan.label || '')} · ${Number(premium.userPlan.aiCreditsRemaining || 0)} AI credit qoldi` : 'Website generator va slide generator premium orqali ochiladi.'}</div>
    `;
  }

  function planFeatures(plan) {
    const rows = Array.isArray(plan.features) ? plan.features.slice() : [];
    if (plan.aiCredits) rows.unshift(`${Number(plan.aiCredits)} AI credit`);
    if (plan.maxWebsites) rows.push(`${Number(plan.maxWebsites)} website generation`);
    if (plan.maxSlides) rows.push(`${Number(plan.maxSlides)} slide generation`);
    if (plan.seatLimit) rows.unshift(`${Number(plan.seatLimit)} user qamrovi`);
    return rows;
  }

  function renderPlanGrid(container, scope) {
    const current = state.selectedScope === scope ? state.selectedPlanId : '';
    const cycle = state.billingCycle;
    container.innerHTML = (state.plans[scope] || []).map((plan) => `
      <article class="plan-card${current === plan.id ? ' selected active' : ''}" data-plan-scope="${escapeHtml(scope)}" data-plan-id="${escapeHtml(plan.id)}">
        <div class="badge-strip">
          <span class="info-badge">${escapeHtml(scope === 'user' ? 'User premium' : 'Campus plan')}</span>
          ${plan.yearlyDiscountLabel ? `<span class="info-badge"><i class="fa-solid fa-badge-percent"></i> ${escapeHtml(plan.yearlyDiscountLabel)}</span>` : ''}
        </div>
        <div class="plan-name">${escapeHtml(plan.label)}</div>
        <div class="plan-price">${escapeHtml(formatMoney(cycle === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice))} <small>/${cycle === 'yearly' ? 'yil' : 'oy'}</small></div>
        <ul class="plan-list">${planFeatures(plan).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        <button class="primary-btn" type="button">Tanlash</button>
      </article>
    `).join('');

    container.querySelectorAll('[data-plan-id]').forEach((card) => {
      card.addEventListener('click', () => {
        state.selectedScope = card.getAttribute('data-plan-scope') || 'user';
        state.selectedPlanId = card.getAttribute('data-plan-id') || '';
        syncSelectedPlan();
        renderPlans();
      });
    });
  }

  function renderPlans() {
    renderPlanGrid(els.userPlans, 'user');
    renderPlanGrid(els.campusPlans, 'university');
    syncSelectedPlan();
  }

  function renderHistory() {
    if (!Array.isArray(state.requests) || !state.requests.length) {
      els.paymentHistory.innerHTML = '<div class="empty-state">Hozircha premium so‘rovi yo‘q.</div>';
      return;
    }
    els.paymentHistory.innerHTML = state.requests.map((item) => `
      <div class="list-card">
        <div class="list-line">
          <div>
            <div class="list-title">${escapeHtml(item.planLabel || item.planId || 'Plan')}</div>
            <div class="list-meta">${escapeHtml(item.planScope === 'university' ? 'Campus plan' : 'User premium')} · ${escapeHtml(item.billingCycle === 'yearly' ? 'Yillik' : 'Oylik')}</div>
          </div>
          <div class="status-pill ${escapeHtml(item.status || 'pending')}">${escapeHtml(item.status || 'pending')}</div>
        </div>
        <div class="list-meta" style="margin-top:10px">${escapeHtml(formatMoney(item.priceAmount))} · ${escapeHtml(formatDate(item.createdAt))}</div>
        ${item.adminNote ? `<div class="list-meta" style="margin-top:8px">Admin izohi: ${escapeHtml(item.adminNote)}</div>` : ''}
      </div>
    `).join('');
  }

  async function loadData() {
    const [me, premiumData, payments] = await Promise.all([
      api('/api/me'),
      api('/api/premium/plans'),
      api('/api/premium/payments')
    ]);
    state.me = me.user || me;
    state.plans = premiumData.plans || { user: [], university: [] };
    state.premium = premiumData.premium || {};
    state.paymentMethod = premiumData.paymentMethod || {};
    state.requests = payments.requests || [];
    els.dashboardLink.href = dashboardPath(state.me.role);
    renderStats();
    renderPaymentCard();
    renderCurrentPremiumCard();
    if (!state.selectedPlanId) {
      const focus = new URLSearchParams(window.location.search).get('focus');
      state.selectedScope = focus === 'university' ? 'university' : 'user';
      state.selectedPlanId = ((state.plans[state.selectedScope] || [])[0] || {}).id || '';
    }
    renderPlans();
    renderHistory();
  }

  async function submitPayment(event) {
    event.preventDefault();
    const screenshot = els.paymentScreenshotInput.files && els.paymentScreenshotInput.files[0];
    if (!state.selectedPlan) return showToast('Avval tarif tanlang', 'error');
    if (!screenshot) return showToast('Screenshot yuklang', 'error');
    const fd = new FormData();
    fd.append('planScope', state.selectedScope);
    fd.append('planId', state.selectedPlan.id);
    fd.append('billingCycle', state.billingCycle);
    fd.append('note', els.paymentNoteInput.value.trim());
    fd.append('screenshot', screenshot);
    try {
      els.submitPaymentBtn.disabled = true;
      const data = await api('/api/premium/payments/request', {
        method: 'POST',
        body: fd,
        headers: {}
      });
      showToast('Premium so‘rovi yuborildi. Admin tasdig‘ini kuting.', 'success');
      els.paymentForm.reset();
      state.requests.unshift(data.request);
      renderHistory();
    } catch (error) {
      showToast(error.message || 'Premium so‘rovi yuborilmadi', 'error');
    } finally {
      els.submitPaymentBtn.disabled = false;
    }
  }

  function bindEvents() {
    applyTheme(localStorage.getItem(THEME_KEY) || 'system');
    els.themeToggleBtn.addEventListener('click', () => {
      const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
      applyTheme(next);
    });
    els.billingSwitch.querySelectorAll('[data-cycle]').forEach((button) => {
      button.addEventListener('click', () => {
        state.billingCycle = button.getAttribute('data-cycle') || 'monthly';
        els.billingSwitch.querySelectorAll('[data-cycle]').forEach((node) => node.classList.toggle('active', node === button));
        renderPlans();
      });
    });
    els.focusUserBtn.addEventListener('click', () => {
      state.selectedScope = 'user';
      state.selectedPlanId = ((state.plans.user || [])[0] || {}).id || '';
      renderPlans();
      document.getElementById('userPlans').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    els.focusCampusBtn.addEventListener('click', () => {
      state.selectedScope = 'university';
      state.selectedPlanId = ((state.plans.university || [])[0] || {}).id || '';
      renderPlans();
      document.getElementById('campusPlans').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    els.paymentForm.addEventListener('submit', submitPayment);
  }

  bindEvents();
  loadData().catch((error) => {
    showToast(error.message || 'Payment center yuklanmadi', 'error');
  });
})();
