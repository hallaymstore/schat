(function () {
  const TOKEN_KEY = 'token';
  const THEME_KEY = 'theme';
  const state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    admin: null,
    requests: [],
    status: 'pending',
    scope: ''
  };

  const els = {
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    statsGrid: document.getElementById('statsGrid'),
    statusSwitch: document.getElementById('statusSwitch'),
    scopeSwitch: document.getElementById('scopeSwitch'),
    refreshBtn: document.getElementById('refreshBtn'),
    requestList: document.getElementById('requestList'),
    toast: document.getElementById('toast')
  };

  function showToast(message, type) {
    if (!message) return;
    els.toast.textContent = message;
    els.toast.className = `toast ${type || ''}`.trim();
    els.toast.classList.remove('hidden');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => els.toast.classList.add('hidden'), 3400);
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

  async function api(path, options) {
    if (!state.token) {
      window.location.href = '/login.html?next=' + encodeURIComponent('/premium-requests.html');
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
        window.location.href = '/login.html?next=' + encodeURIComponent('/premium-requests.html');
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

  function formatMoney(value) {
    return `${Number(value || 0).toLocaleString('uz-UZ')} so‘m`;
  }

  function renderStats() {
    const list = state.requests || [];
    const pending = list.filter((item) => item.status === 'pending').length;
    const approved = list.filter((item) => item.status === 'approved').length;
    const campus = list.filter((item) => item.planScope === 'university').length;
    els.statsGrid.innerHTML = [
      { label: 'Pending', value: String(pending), note: 'Hali ko‘rib chiqilmagan so‘rovlar' },
      { label: 'Approved', value: String(approved), note: 'Tasdiqlangan so‘rovlar' },
      { label: 'Campus', value: String(campus), note: 'Universitet planlari ulushi' }
    ].map((item) => `
      <div class="stat-card">
        <div class="stat-label">${escapeHtml(item.label)}</div>
        <div class="stat-value">${escapeHtml(item.value)}</div>
        <div class="stat-note">${escapeHtml(item.note)}</div>
      </div>
    `).join('');
  }

  function renderRequests() {
    if (!Array.isArray(state.requests) || !state.requests.length) {
      els.requestList.innerHTML = '<div class="empty-state">Bu filter bo‘yicha so‘rov topilmadi.</div>';
      return;
    }
    els.requestList.innerHTML = state.requests.map((item) => {
      const user = item.user || {};
      const name = window.HallaymPremiumUi
        ? window.HallaymPremiumUi.renderNameWithBadges(user, { fallback: user.username || 'User' })
        : escapeHtml(user.fullName || user.username || 'User');
      return `
        <div class="list-card">
          <div class="list-line">
            <div>
              <div class="list-title">${name}</div>
              <div class="list-meta">@${escapeHtml(user.username || '')} · ${escapeHtml(item.planScope === 'university' ? 'Campus plan' : 'User premium')}</div>
            </div>
            <div class="status-pill ${escapeHtml(item.status || 'pending')}">${escapeHtml(item.status || 'pending')}</div>
          </div>
          <div class="badge-strip" style="margin-top:12px">
            <span class="info-badge"><i class="fa-solid fa-layer-group"></i> ${escapeHtml(item.planLabel || item.planId || 'Plan')}</span>
            <span class="info-badge"><i class="fa-solid fa-calendar"></i> ${escapeHtml(item.billingCycle === 'yearly' ? 'Yillik' : 'Oylik')}</span>
            <span class="info-badge"><i class="fa-solid fa-money-bill"></i> ${escapeHtml(formatMoney(item.priceAmount))}</span>
          </div>
          <div class="list-meta" style="margin-top:12px">${escapeHtml(user.university || 'Universitet ko‘rsatilmagan')} · ${escapeHtml(formatDate(item.createdAt))}</div>
          ${item.note ? `<div class="list-meta" style="margin-top:8px">User izohi: ${escapeHtml(item.note)}</div>` : ''}
          ${item.adminNote ? `<div class="list-meta" style="margin-top:8px">Admin izohi: ${escapeHtml(item.adminNote)}</div>` : ''}
          <div class="list-actions">
            ${item.screenshotUrl ? `<a class="ghost-btn" href="${escapeHtml(item.screenshotUrl)}" target="_blank" rel="noopener"><i class="fa-solid fa-image"></i> Screenshot</a>` : ''}
            ${item.status === 'pending' ? `<button class="primary-btn" type="button" data-approve="${escapeHtml(item.id || '')}"><i class="fa-solid fa-circle-check"></i> Approve</button><button class="danger-btn" type="button" data-reject="${escapeHtml(item.id || '')}"><i class="fa-solid fa-circle-xmark"></i> Reject</button>` : ''}
          </div>
        </div>
      `;
    }).join('');

    els.requestList.querySelectorAll('[data-approve]').forEach((button) => {
      button.addEventListener('click', async () => {
        const adminNote = window.prompt('Admin izohi (ixtiyoriy)', 'Tasdiqlandi') || '';
        try {
          await api(`/api/admin/premium-requests/${encodeURIComponent(button.getAttribute('data-approve') || '')}/approve`, {
            method: 'POST',
            body: JSON.stringify({ adminNote })
          });
          showToast('Premium tasdiqlandi', 'success');
          await loadRequests();
        } catch (error) {
          showToast(error.message || 'Approve bo‘lmadi', 'error');
        }
      });
    });

    els.requestList.querySelectorAll('[data-reject]').forEach((button) => {
      button.addEventListener('click', async () => {
        const adminNote = window.prompt('Rad etish sababi', 'Screenshot qayta yuborilishi kerak') || 'Rad etildi';
        try {
          await api(`/api/admin/premium-requests/${encodeURIComponent(button.getAttribute('data-reject') || '')}/reject`, {
            method: 'POST',
            body: JSON.stringify({ adminNote })
          });
          showToast('So‘rov rad etildi', 'success');
          await loadRequests();
        } catch (error) {
          showToast(error.message || 'Reject bo‘lmadi', 'error');
        }
      });
    });
  }

  async function loadRequests() {
    const query = new URLSearchParams();
    if (state.status) query.set('status', state.status);
    if (state.scope) query.set('planScope', state.scope);
    const [whoami, data] = await Promise.all([
      api('/api/admin/whoami'),
      api(`/api/admin/premium-requests?${query.toString()}`)
    ]);
    state.admin = whoami.admin || {};
    state.requests = data.requests || [];
    renderStats();
    renderRequests();
  }

  function bindFilters(container, key) {
    container.querySelectorAll('button[data-status], button[data-scope]').forEach((button) => {
      button.addEventListener('click', () => {
        if (key === 'status') state.status = button.getAttribute('data-status') || '';
        else state.scope = button.getAttribute('data-scope') || '';
        container.querySelectorAll('button').forEach((node) => node.classList.toggle('active', node === button));
        loadRequests().catch((error) => showToast(error.message || 'Requestlar yuklanmadi', 'error'));
      });
    });
  }

  function init() {
    applyTheme(localStorage.getItem(THEME_KEY) || 'system');
    els.themeToggleBtn.addEventListener('click', () => {
      const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
      applyTheme(next);
    });
    bindFilters(els.statusSwitch, 'status');
    bindFilters(els.scopeSwitch, 'scope');
    els.refreshBtn.addEventListener('click', () => loadRequests().catch((error) => showToast(error.message || 'Yangilanmadi', 'error')));
    loadRequests().catch((error) => showToast(error.message || 'Admin premium requests yuklanmadi', 'error'));
  }

  init();
})();
