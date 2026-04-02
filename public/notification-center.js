(function () {
  const TOKEN_KEY = 'token';
  const THEME_KEY = 'theme';
  const state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    me: null,
    notifications: [],
    unreadCount: 0,
    filter: 'all'
  };

  const els = {
    dashboardLink: document.getElementById('dashboardLink'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    markAllBtn: document.getElementById('markAllBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    statsGrid: document.getElementById('statsGrid'),
    filterSwitch: document.getElementById('filterSwitch'),
    summaryCard: document.getElementById('summaryCard'),
    notificationsList: document.getElementById('notificationsList'),
    toast: document.getElementById('toast')
  };

  function showToast(message, type) {
    if (!message) return;
    els.toast.textContent = message;
    els.toast.className = `toast ${type || ''}`.trim();
    els.toast.classList.remove('hidden');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => els.toast.classList.add('hidden'), 3200);
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
    if (els.themeToggleBtn) {
      const dark = document.documentElement.classList.contains('dark');
      els.themeToggleBtn.innerHTML = dark
        ? '<i class="fa-solid fa-sun"></i> Kunduzgi'
        : '<i class="fa-solid fa-moon"></i> Tungi';
    }
  }

  function dashboardPath(role) {
    const safe = String(role || '').trim().toLowerCase();
    if (safe === 'teacher') return '/teacher-dashboard.html';
    if (safe === 'admin') return '/admin-dashboard.html';
    if (safe === 'organizer') return '/organizer.html';
    return '/student-dashboard.html';
  }

  async function api(path, options) {
    if (!state.token) {
      window.location.href = '/login.html?next=' + encodeURIComponent('/notification-center.html');
      throw new Error('Authentication required');
    }
    const headers = Object.assign({}, options && options.headers || {}, { Authorization: `Bearer ${state.token}` });
    if (options && options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, Object.assign({}, options || {}, { headers }));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem(TOKEN_KEY);
        window.location.href = '/login.html?next=' + encodeURIComponent('/notification-center.html');
      }
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
  }

  function formatDate(value) {
    if (!value) return '—';
    try {
      return new Intl.DateTimeFormat('uz-UZ', {
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

  function filteredNotifications() {
    const all = Array.isArray(state.notifications) ? state.notifications : [];
    if (state.filter === 'unread') return all.filter((item) => !item.read);
    if (state.filter === 'billing') return all.filter((item) => String(item.type || '').toLowerCase() === 'billing');
    if (state.filter === 'general') return all.filter((item) => String(item.type || '').toLowerCase() !== 'billing');
    return all;
  }

  function renderStats() {
    const list = Array.isArray(state.notifications) ? state.notifications : [];
    const billing = list.filter((item) => String(item.type || '').toLowerCase() === 'billing').length;
    const general = list.length - billing;
    els.statsGrid.innerHTML = [
      { label: 'Unread', value: String(state.unreadCount), note: 'Hali o‘qilmagan xabarlar' },
      { label: 'Billing', value: String(billing), note: 'Premium va to‘lov oqimi' },
      { label: 'General', value: String(general), note: 'Kurs, admin, support va boshqa xabarlar' }
    ].map((item) => `
      <div class="stat-card">
        <div class="stat-label">${escapeHtml(item.label)}</div>
        <div class="stat-value">${escapeHtml(item.value)}</div>
        <div class="stat-note">${escapeHtml(item.note)}</div>
      </div>
    `).join('');
    els.summaryCard.innerHTML = `
      <div class="list-title">Joriy filter</div>
      <div class="list-meta" style="margin-top:6px">${escapeHtml(filterLabel(state.filter))}</div>
      <div class="list-meta" style="margin-top:12px">${escapeHtml(`${filteredNotifications().length} ta notification ko‘rsatilmoqda`)}</div>
    `;
  }

  function filterLabel(value) {
    if (value === 'unread') return 'Faqat unread';
    if (value === 'billing') return 'Faqat billing';
    if (value === 'general') return 'Faqat general';
    return 'Barcha notificationlar';
  }

  function iconFor(item) {
    const raw = String(item.icon || '').trim();
    if (raw) return raw;
    return String(item.type || '').toLowerCase() === 'billing' ? 'fa-wallet' : 'fa-bell';
  }

  function renderNotifications() {
    const items = filteredNotifications();
    if (!items.length) {
      els.notificationsList.innerHTML = '<div class="empty-state">Notification topilmadi.</div>';
      return;
    }
    els.notificationsList.innerHTML = items.map((item) => `
      <div class="list-card" data-notification-id="${escapeHtml(item._id || item.id || '')}">
        <div class="list-line">
          <div>
            <div class="list-title"><i class="fa-solid ${escapeHtml(iconFor(item))}" style="color:var(--ac-teal);margin-right:10px"></i>${escapeHtml(item.title || 'Xabar')}</div>
            <div class="list-meta">${escapeHtml(item.body || '')}</div>
          </div>
          <div class="status-pill ${item.read ? 'approved' : 'pending'}">${item.read ? 'Read' : 'Unread'}</div>
        </div>
        <div class="list-meta" style="margin-top:10px">${escapeHtml(formatDate(item.createdAt))} · ${escapeHtml(String(item.type || 'general'))}</div>
        <div class="list-actions">
          ${item.link ? `<button class="primary-btn" type="button" data-open-link="${escapeHtml(item.link)}"><i class="fa-solid fa-arrow-up-right-from-square"></i> Ochish</button>` : ''}
          ${item.read ? '' : `<button class="ghost-btn" type="button" data-mark-read="${escapeHtml(item._id || item.id || '')}"><i class="fa-solid fa-check"></i> O‘qildi</button>`}
          <button class="soft-btn" type="button" data-delete="${escapeHtml(item._id || item.id || '')}"><i class="fa-solid fa-trash"></i> O‘chirish</button>
        </div>
      </div>
    `).join('');

    els.notificationsList.querySelectorAll('[data-mark-read]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await api(`/api/notifications/${encodeURIComponent(button.getAttribute('data-mark-read') || '')}/read`, { method: 'POST' });
          await loadNotifications();
        } catch (error) {
          showToast(error.message || 'Notification o‘qildi qilinmadi', 'error');
        }
      });
    });

    els.notificationsList.querySelectorAll('[data-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await api(`/api/notifications/${encodeURIComponent(button.getAttribute('data-delete') || '')}`, { method: 'DELETE' });
          await loadNotifications();
          showToast('Notification o‘chirildi', 'success');
        } catch (error) {
          showToast(error.message || 'Notification o‘chirilmadi', 'error');
        }
      });
    });

    els.notificationsList.querySelectorAll('[data-open-link]').forEach((button) => {
      button.addEventListener('click', async () => {
        const card = button.closest('[data-notification-id]');
        const id = card ? card.getAttribute('data-notification-id') : '';
        if (id) {
          try { await api(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }); } catch (_) {}
        }
        window.location.href = button.getAttribute('data-open-link') || '/';
      });
    });
  }

  async function loadNotifications() {
    const [me, data] = await Promise.all([
      api('/api/me'),
      api('/api/notifications')
    ]);
    state.me = me.user || me;
    state.notifications = Array.isArray(data.notifications) ? data.notifications : [];
    state.unreadCount = Number(data.unreadCount || 0);
    els.dashboardLink.href = dashboardPath(state.me.role);
    renderStats();
    renderNotifications();
  }

  function bindEvents() {
    els.themeToggleBtn.addEventListener('click', () => {
      const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
      applyTheme(next);
    });
    els.markAllBtn.addEventListener('click', async () => {
      try {
        await api('/api/notifications/read-all', { method: 'POST' });
        await loadNotifications();
        showToast('Barcha notificationlar o‘qildi qilindi', 'success');
      } catch (error) {
        showToast(error.message || 'Amal bajarilmadi', 'error');
      }
    });
    els.refreshBtn.addEventListener('click', () => loadNotifications().catch((error) => showToast(error.message || 'Yangilanmadi', 'error')));
    els.filterSwitch.querySelectorAll('[data-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        state.filter = button.getAttribute('data-filter') || 'all';
        els.filterSwitch.querySelectorAll('[data-filter]').forEach((node) => node.classList.toggle('active', node === button));
        renderStats();
        renderNotifications();
      });
    });
  }

  function init() {
    applyTheme(localStorage.getItem(THEME_KEY) || 'system');
    bindEvents();
    loadNotifications().catch((error) => showToast(error.message || 'Notificationlar yuklanmadi', 'error'));
  }

  init();
})();
