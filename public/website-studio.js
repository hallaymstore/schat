(function () {
  const TOKEN_KEY = 'token';
  const THEME_KEY = 'theme';
  const DEFAULT_NEXT = '/website-studio.html';
  const DEFAULT_TEMPLATES = [
    { id: 'startup-pitch', label: 'Startup Pitch', mood: 'Investor va tanlov uchun premium pitch landing', summary: 'Qisqa, ishonchli va CTA markazli sahifa.' },
    { id: 'edtech-launch', label: 'EdTech Launch', mood: 'Ta\'lim va community startup uchun yorqin ko\'rinish', summary: 'Course, mentorship va registration oqimi bilan.' },
    { id: 'marketplace-lite', label: 'Marketplace Lite', mood: 'Service/product showcase va lead yig\'ish uchun', summary: 'Catalog emas, lekin kuchli CTA va benefit bloklari bilan.' },
    { id: 'saas-beta', label: 'SaaS Beta', mood: 'Product waitlist, login va dashboard preview bilan', summary: 'B2B/B2C beta launch uchun minimal stack.' }
  ];

  const PAGE_ITEMS = [
    { id: 'index', label: 'Landing', icon: 'fa-solid fa-house' },
    { id: 'register', label: 'Register', icon: 'fa-solid fa-user-plus', authOnly: true },
    { id: 'login', label: 'Login', icon: 'fa-solid fa-right-to-bracket', authOnly: true },
    { id: 'account', label: 'Account', icon: 'fa-solid fa-id-card', authOnly: true }
  ];

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    me: null,
    templates: DEFAULT_TEMPLATES.slice(),
    projects: [],
    currentProject: null,
    currentDetail: null,
    currentPage: 'index',
    toastTimer: null,
    slugDirty: false,
    qs: new URLSearchParams(window.location.search)
  };

  const els = {
    welcomeLine: document.getElementById('welcomeLine'),
    dashboardLink: document.getElementById('dashboardLink'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    projectForm: document.getElementById('projectForm'),
    startupNameInput: document.getElementById('startupNameInput'),
    slugInput: document.getElementById('slugInput'),
    promptInput: document.getElementById('promptInput'),
    audienceInput: document.getElementById('audienceInput'),
    categoryInput: document.getElementById('categoryInput'),
    toneInput: document.getElementById('toneInput'),
    templateInput: document.getElementById('templateInput'),
    featureAuth: document.getElementById('featureAuth'),
    featureWaitlist: document.getElementById('featureWaitlist'),
    featureContact: document.getElementById('featureContact'),
    demoProjectBtn: document.getElementById('demoProjectBtn'),
    resetFormBtn: document.getElementById('resetFormBtn'),
    refreshProjectsBtn: document.getElementById('refreshProjectsBtn'),
    generateBtn: document.getElementById('generateBtn'),
    projectList: document.getElementById('projectList'),
    projectTitle: document.getElementById('projectTitle'),
    projectSubtitle: document.getElementById('projectSubtitle'),
    projectMetaRow: document.getElementById('projectMetaRow'),
    copyPublishedBtn: document.getElementById('copyPublishedBtn'),
    openPreviewBtn: document.getElementById('openPreviewBtn'),
    togglePublishBtn: document.getElementById('togglePublishBtn'),
    deleteProjectBtn: document.getElementById('deleteProjectBtn'),
    pageSwitcher: document.getElementById('pageSwitcher'),
    previewFrame: document.getElementById('previewFrame'),
    projectStats: document.getElementById('projectStats'),
    leadList: document.getElementById('leadList'),
    memberList: document.getElementById('memberList'),
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

  function normalizeNextPath(raw) {
    const value = String(raw || '').trim();
    if (!value.startsWith('/')) return '';
    if (value.startsWith('//')) return '';
    return value;
  }

  function dashboardPathForRole(role) {
    const normalized = String(role || '').trim().toLowerCase();
    if (normalized === 'teacher') return '/teacher-dashboard.html';
    if (normalized === 'tutor') return '/tutor-dashboard.html';
    if (normalized === 'admin') return '/admin-dashboard.html';
    if (normalized === 'rector') return '/rector-dashboard.html';
    if (normalized === 'prorector') return '/prorector-dashboard.html';
    if (normalized === 'dean') return '/dean-dashboard.html';
    if (normalized === 'organizer') return '/organizer.html';
    return '/student-dashboard.html';
  }

  function slugify(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);
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

  function formatFeatures(features) {
    const safe = Object.assign({ authEnabled: true, waitlistEnabled: true, contactEnabled: true }, features || {});
    return [
      safe.authEnabled ? 'Register/Login' : '',
      safe.waitlistEnabled ? 'Waitlist' : '',
      safe.contactEnabled ? 'Contact form' : ''
    ].filter(Boolean);
  }

  function showToast(message, type) {
    if (!message || !els.toast) return;
    clearTimeout(state.toastTimer);
    els.toast.textContent = message;
    els.toast.className = `toast${type ? ` ${type}` : ''}`;
    els.toast.classList.remove('hidden');
    state.toastTimer = window.setTimeout(() => {
      els.toast.classList.add('hidden');
    }, 3400);
  }

  function setButtonLoading(button, loading, labelHtml) {
    if (!button) return;
    if (!button.dataset.label && labelHtml === undefined) button.dataset.label = button.innerHTML;
    if (labelHtml !== undefined) {
      if (!button.dataset.label) button.dataset.label = button.innerHTML;
      button.innerHTML = labelHtml;
    } else if (!loading && button.dataset.label) {
      button.innerHTML = button.dataset.label;
    }
    button.disabled = !!loading;
    button.classList.toggle('is-loading', !!loading);
  }

  function syncThemeButton() {
    if (!els.themeToggleBtn) return;
    const isDark = document.documentElement.classList.contains('dark');
    els.themeToggleBtn.innerHTML = isDark
      ? '<i class="fa-solid fa-sun"></i> Kunduzgi'
      : '<i class="fa-solid fa-moon"></i> Tungi';
  }

  function toggleTheme() {
    const html = document.documentElement;
    const nextDark = !html.classList.contains('dark');
    html.classList.toggle('dark', nextDark);
    localStorage.setItem(THEME_KEY, nextDark ? 'dark' : 'light');
    syncThemeButton();
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
      if (response.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        window.location.href = `/login.html?next=${encodeURIComponent(DEFAULT_NEXT)}`;
      }
      if (response.status === 403 && data && data.redirect) {
        window.location.href = data.redirect;
        throw new Error(data.error || 'Premium ruxsat talab qilinadi.');
      }
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
  }

  function renderTemplateOptions() {
    if (!els.templateInput) return;
    els.templateInput.innerHTML = state.templates.map((template) => {
      const label = `${template.label} - ${template.mood || template.summary || ''}`.trim();
      return `<option value="${escapeHtml(template.id)}">${escapeHtml(label)}</option>`;
    }).join('');
    if (!els.templateInput.value && state.templates[0]) {
      els.templateInput.value = state.templates[0].id;
    }
  }

  function renderPlaceholderFrame() {
    if (!els.previewFrame) return;
    els.previewFrame.removeAttribute('src');
    els.previewFrame.srcdoc = '<!doctype html><html lang="uz"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><style>*{box-sizing:border-box}html,body{margin:0;height:100%;font-family:Inter,system-ui,sans-serif;background:linear-gradient(160deg,#f4fbfa,#ecf7f6);color:#113934}.shell{height:100%;display:grid;place-items:center;padding:24px}.card{max-width:620px;padding:32px;border-radius:28px;border:1px solid rgba(15,111,102,.12);background:rgba(255,255,255,.88);box-shadow:0 24px 60px rgba(9,42,38,.08);text-align:center}h1{margin:0 0 12px;font-size:40px;line-height:1.02}p{margin:0;color:rgba(17,57,52,.7);line-height:1.7}.row{display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:18px}.pill{display:inline-flex;padding:10px 14px;border-radius:999px;background:rgba(15,143,131,.08);border:1px solid rgba(15,143,131,.12);font-size:12px;font-weight:800;color:#0f6f66;text-transform:uppercase;letter-spacing:.1em}</style></head><body><div class="shell"><div class="card"><div class="pill">HALLAYM AI Website Studio</div><h1>Startup website preview shu yerda chiqadi</h1><p>Chap tomondan startup nomi va g\'oyani kiriting. HALLAYM AI landing, register/login va serverli mini website tayyorlaydi.</p><div class="row"><span class="pill">Landing</span><span class="pill">Register / Login</span><span class="pill">Contact / Waitlist</span></div></div></div></body></html>';
  }

  function pagePreviewUrl(project, pageId) {
    if (!project) return '';
    const links = project.pageLinks || {};
    if (pageId && links[pageId]) return links[pageId];
    if (pageId === 'index') return project.previewUrl || '';
    return `${project.previewUrl || ''}/${pageId}`;
  }

  function renderPageSwitcher() {
    if (!els.pageSwitcher) return;
    const project = state.currentProject;
    const authEnabled = !!(project && project.serverFeatures && project.serverFeatures.authEnabled);
    els.pageSwitcher.innerHTML = PAGE_ITEMS.map((page) => {
      const disabled = !project || (page.authOnly && !authEnabled);
      const active = project && state.currentPage === page.id;
      return `<button class="nav-pill${active ? ' active' : ''}" type="button" data-page-id="${escapeHtml(page.id)}"${disabled ? ' disabled' : ''}><i class="${escapeHtml(page.icon)}"></i> ${escapeHtml(page.label)}</button>`;
    }).join('');
    els.pageSwitcher.querySelectorAll('[data-page-id]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.disabled || !state.currentProject) return;
        state.currentPage = button.getAttribute('data-page-id') || 'index';
        renderPageSwitcher();
        syncPreviewFrame();
      });
    });
  }

  function syncPreviewFrame() {
    if (!els.previewFrame) return;
    const project = state.currentProject;
    if (!project) {
      renderPlaceholderFrame();
      return;
    }
    const target = pagePreviewUrl(project, state.currentPage);
    els.previewFrame.removeAttribute('srcdoc');
    els.previewFrame.src = target || project.previewUrl || 'about:blank';
  }

  function metaChip(icon, label) {
    return `<span class="deck-chip"><i class="${escapeHtml(icon)}"></i> ${escapeHtml(label)}</span>`;
  }

  function syncWorkspaceHeader() {
    const project = state.currentProject;
    if (!project) {
      els.projectTitle.textContent = 'Website Studio tayyor';
      els.projectSubtitle.textContent = 'Chap tomondan startup ma\'lumotlarini kiriting va AI website preview\'ni shu yerda ko\'ring.';
      els.projectMetaRow.innerHTML = [
        metaChip('fa-solid fa-globe', 'Subdomain bilan publish'),
        metaChip('fa-solid fa-shield-halved', 'Minimal server functions'),
        metaChip('fa-solid fa-sparkles', 'HALLAYM AI generation')
      ].join('');
      return;
    }
    const features = formatFeatures(project.serverFeatures);
    els.projectTitle.textContent = project.startupName || 'Untitled startup';
    els.projectSubtitle.textContent = project.summary || 'Competition-ready landing, auth va lead oqimi tayyor.';
    els.projectMetaRow.innerHTML = [
      metaChip('fa-solid fa-link', project.publishedUrl || `${project.slug}.edu.hallaym.site`),
      metaChip('fa-solid fa-layer-group', project.templateId || 'startup-pitch'),
      metaChip('fa-solid fa-globe', project.status === 'published' ? 'Published' : 'Draft'),
      metaChip('fa-solid fa-users', `${Number(project.memberCount || 0)} member`),
      metaChip('fa-solid fa-envelope-open-text', `${Number(project.leadCount || 0)} lead`)
    ].concat(project.publishedAliasUrl ? [metaChip('fa-solid fa-sitemap', project.publishedAliasUrl)] : []).concat(features.map((item) => metaChip('fa-solid fa-check', item))).join('');
  }

  function renderMiniList(container, items, emptyText, itemRenderer) {
    if (!container) return;
    if (!Array.isArray(items) || !items.length) {
      container.innerHTML = `<div class="empty-state" style="min-height:140px;">${escapeHtml(emptyText)}</div>`;
      return;
    }
    container.innerHTML = items.slice(0, 8).map(itemRenderer).join('');
  }

  function renderStats() {
    const project = state.currentProject;
    const detail = state.currentDetail;
    if (!project) {
      els.projectStats.innerHTML = '<div class="stat-box"><p class="badge-label">Website</p><strong>0</strong><span>Website yaratilganda bu yerda lead, member va publish holati ko\'rinadi.</span></div><div class="stat-box"><p class="badge-label">Preview</p><strong>16:9</strong><span>Landing, register, login va account sahifalari iframe ichida preview qilinadi.</span></div><div class="stat-box"><p class="badge-label">Subdomain</p><strong>edu</strong><span>`slug.edu.hallaym.site` formatidagi public URL shu yerda ko\'rinadi.</span></div><div class="stat-box"><p class="badge-label">AI</p><strong>HALLAYM</strong><span>Branding user tomonda faqat HALLAYM AI bo\'lib qoladi.</span></div>';
      return;
    }
    const publishedSince = project.publishedAt ? formatDate(project.publishedAt) : 'hali yo\'q';
    const updatedAt = project.updatedAt ? formatDate(project.updatedAt) : '-';
    const featureLine = formatFeatures(project.serverFeatures).join(', ') || 'Landing only';
    els.projectStats.innerHTML = `<div class="stat-box"><p class="badge-label">Website URL</p><strong>${escapeHtml(project.slug || '-')}</strong><span>${escapeHtml(project.publishedUrl || '-')}</span>${project.publishedAliasUrl ? `<span>${escapeHtml(`Alias: ${project.publishedAliasUrl}`)}</span>` : ''}</div><div class="stat-box"><p class="badge-label">Status</p><strong>${escapeHtml(project.status === 'published' ? 'LIVE' : 'DRAFT')}</strong><span>Oxirgi yangilanish: ${escapeHtml(updatedAt)}</span></div><div class="stat-box"><p class="badge-label">Audience</p><strong>${escapeHtml(project.audience || project.category || 'Startup')}</strong><span>${escapeHtml(featureLine)}</span></div><div class="stat-box"><p class="badge-label">Traffic</p><strong>${escapeHtml(String(Number(project.memberCount || 0) + Number(project.leadCount || 0)))}</strong><span>${escapeHtml(`Published: ${publishedSince}`)}</span></div>`;
    renderMiniList(els.leadList, detail && Array.isArray(detail.recentLeads) ? detail.recentLeads : [], 'Hozircha lead yo\'q. Contact yoki waitlist form ishlaganidan keyin shu yerda ko\'rinadi.', function (lead) {
      const meta = [lead.leadType, lead.email, lead.company].filter(Boolean).join(' | ');
      return `<div class="mini-item"><strong>${escapeHtml(lead.name || 'Lead')}</strong><p>${escapeHtml(lead.message || meta || 'Ma\'lumot yuborgan foydalanuvchi.')}</p><span>${escapeHtml(meta || formatDate(lead.createdAt) || 'Lead')}</span></div>`;
    });
    renderMiniList(els.memberList, detail && Array.isArray(detail.recentMembers) ? detail.recentMembers : [], 'Ro\'yxatdan o\'tgan a\'zolar hali yo\'q. Register form ishlagach shu yerda ko\'rinadi.', function (member) {
      const meta = [member.email, member.company].filter(Boolean).join(' | ');
      return `<div class="mini-item"><strong>${escapeHtml(member.fullName || member.email || 'Member')}</strong><p>${escapeHtml(meta || 'Ro\'yxatdan o\'tgan a\'zo')}</p><span>${escapeHtml(member.lastLoginAt ? `Login: ${formatDate(member.lastLoginAt)}` : (formatDate(member.createdAt) || 'Member'))}</span></div>`;
    });
  }

  function syncActionButtons() {
    const project = state.currentProject;
    const hasProject = !!project;
    els.copyPublishedBtn.disabled = !hasProject;
    els.openPreviewBtn.disabled = !hasProject;
    els.deleteProjectBtn.disabled = !hasProject;
    els.togglePublishBtn.disabled = !hasProject;
    if (!hasProject) {
      els.togglePublishBtn.innerHTML = '<i class="fa-solid fa-globe"></i> Publish';
      return;
    }
    els.togglePublishBtn.innerHTML = project.status === 'published'
      ? '<i class="fa-solid fa-eye-slash"></i> Draftga olish'
      : '<i class="fa-solid fa-globe"></i> Publish qilish';
  }

  function renderProjectList() {
    const items = Array.isArray(state.projects) ? state.projects : [];
    if (!items.length) {
      els.projectList.innerHTML = '<div class="empty-state">Hozircha website yo\'q. Birinchi startup website\'ingizni AI bilan tayyorlang.</div>';
      return;
    }
    const currentId = String(state.currentProject && state.currentProject.id || '');
    els.projectList.innerHTML = items.map((project) => {
      const active = currentId && currentId === String(project.id || '') ? ' active' : '';
      const features = formatFeatures(project.serverFeatures);
      const updatedAt = project.updatedAt ? formatDate(project.updatedAt) : '';
      return `<div class="history-card${active}" data-project-id="${escapeHtml(project.id)}"><div class="history-card-head"><div style="min-width:0;"><strong>${escapeHtml(project.startupName || 'Untitled startup')}</strong><p>${escapeHtml(project.summary || project.prompt || 'Competition-ready website')}</p></div><button class="history-delete" type="button" data-delete-project="${escapeHtml(project.id)}" aria-label="Delete project"><i class="fa-solid fa-trash"></i></button></div><div class="history-meta"><span class="status-badge ${project.status === 'published' ? 'live' : 'draft'}">${escapeHtml(project.status || 'draft')}</span><span>${escapeHtml(project.slug || '-')}</span></div><div class="history-meta"><span>${escapeHtml(project.templateId || 'startup-pitch')}</span><span>${escapeHtml(`${Number(project.memberCount || 0)} member / ${Number(project.leadCount || 0)} lead`)}</span></div><div class="history-meta"><span>${escapeHtml(features.join(', ') || 'Landing')}</span><span>${escapeHtml(updatedAt || '')}</span></div></div>`;
    }).join('');
    els.projectList.querySelectorAll('[data-project-id]').forEach((card) => {
      card.addEventListener('click', async (event) => {
        if (event.target.closest('[data-delete-project]')) return;
        const projectId = card.getAttribute('data-project-id');
        if (!projectId) return;
        await openProject(projectId);
      });
    });
    els.projectList.querySelectorAll('[data-delete-project]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const projectId = button.getAttribute('data-delete-project');
        if (!projectId) return;
        await deleteProject(projectId);
      });
    });
  }

  function mergeProjectSummary(project) {
    if (!project || !project.id) return;
    const current = Array.isArray(state.projects) ? state.projects.slice() : [];
    const index = current.findIndex((item) => String(item.id) === String(project.id));
    if (index >= 0) current[index] = Object.assign({}, current[index], project);
    else current.unshift(project);
    state.projects = current.sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    });
  }

  function selectProject(summary, detail) {
    state.currentProject = summary || null;
    state.currentDetail = detail || null;
    const authEnabled = !!(summary && summary.serverFeatures && summary.serverFeatures.authEnabled);
    if (!summary) state.currentPage = 'index';
    else if (!authEnabled && PAGE_ITEMS.some((page) => page.id === state.currentPage && page.authOnly)) state.currentPage = 'index';
    syncWorkspaceHeader();
    renderPageSwitcher();
    syncPreviewFrame();
    renderStats();
    renderProjectList();
    syncActionButtons();
  }

  async function openProject(projectId) {
    if (!projectId) return;
    const data = await api(`/api/websites/${encodeURIComponent(projectId)}`);
    selectProject(data.project, data);
  }

  async function loadProjects(options) {
    const data = await api('/api/websites');
    if (Array.isArray(data.templates) && data.templates.length) {
      state.templates = data.templates.slice();
      renderTemplateOptions();
    }
    state.projects = Array.isArray(data.projects) ? data.projects : [];
    renderProjectList();
    const preferredId = String(options && options.preferredId || state.qs.get('id') || state.currentProject && state.currentProject.id || '').trim();
    if (preferredId) {
      const found = state.projects.find((item) => String(item.id) === preferredId);
      if (found) {
        await openProject(found.id);
        return;
      }
    }
    if (state.projects[0]) {
      await openProject(state.projects[0].id);
      return;
    }
    selectProject(null, null);
  }

  function readFormPayload() {
    return {
      startupName: String(els.startupNameInput.value || '').trim(),
      slug: slugify(els.slugInput.value),
      prompt: String(els.promptInput.value || '').trim(),
      audience: String(els.audienceInput.value || '').trim(),
      category: String(els.categoryInput.value || '').trim(),
      tone: String(els.toneInput.value || '').trim(),
      templateId: String(els.templateInput.value || '').trim(),
      serverFeatures: {
        authEnabled: !!els.featureAuth.checked,
        waitlistEnabled: !!els.featureWaitlist.checked,
        contactEnabled: !!els.featureContact.checked
      }
    };
  }

  function resetForm() {
    els.projectForm.reset();
    state.slugDirty = false;
    if (state.templates[0]) els.templateInput.value = state.templates[0].id;
    els.featureAuth.checked = true;
    els.featureWaitlist.checked = true;
    els.featureContact.checked = true;
    els.slugInput.value = els.startupNameInput.value ? slugify(els.startupNameInput.value) : '';
  }

  function fillDemoProject() {
    els.startupNameInput.value = 'StartHub';
    els.slugInput.value = 'starthub';
    els.promptInput.value = 'Startup tanlovlari uchun jamoalarga mentor topish, demo-day booking qilish va investorlar bilan tez bog\'lanishni bir joyda boshqaradigan platforma kerak. Landing investor-friendly bo\'lsin, register/login bo\'lsin, waitlist va aloqa formasi ishlasin.';
    els.audienceInput.value = 'Hakamlar, mentorlar, investorlar va startup jamoalari';
    els.categoryInput.value = 'Startup platform / competition tech';
    els.toneInput.value = 'Premium, rasmiy, ishonchli va investor-friendly';
    els.templateInput.value = 'startup-pitch';
    els.featureAuth.checked = true;
    els.featureWaitlist.checked = true;
    els.featureContact.checked = true;
    state.slugDirty = true;
    showToast('Demo loyiha maydonga joylandi. Endi AI bilan yaratishni bossangiz bo\'ldi.', 'success');
  }

  async function handleGenerate(event) {
    event.preventDefault();
    const payload = readFormPayload();
    if (!payload.startupName || !payload.prompt) {
      showToast('Startup nomi va g\'oya tavsifi kerak.', 'error');
      return;
    }
    setButtonLoading(els.generateBtn, true, '<i class="fa-solid fa-spinner fa-spin"></i> Yaratilmoqda...');
    try {
      const data = await api('/api/websites/generate', { method: 'POST', body: JSON.stringify(payload) });
      if (Array.isArray(data.templates) && data.templates.length) {
        state.templates = data.templates.slice();
        renderTemplateOptions();
      }
      mergeProjectSummary(data.project);
      renderProjectList();
      if (data.project && data.project.id) await openProject(data.project.id);
      showToast('Website tayyorlandi. Preview va subdomain URL tayyor.', 'success');
    } catch (error) {
      showToast(error.message || 'Website yaratilmadi.', 'error');
    } finally {
      setButtonLoading(els.generateBtn, false);
    }
  }

  async function handlePublishToggle() {
    const project = state.currentProject;
    if (!project || !project.id) return;
    const nextStatus = project.status === 'published' ? 'draft' : 'published';
    setButtonLoading(els.togglePublishBtn, true, nextStatus === 'published' ? '<i class="fa-solid fa-spinner fa-spin"></i> Publish...' : '<i class="fa-solid fa-spinner fa-spin"></i> Draft...');
    try {
      const data = await api(`/api/websites/${encodeURIComponent(project.id)}/publish`, { method: 'POST', body: JSON.stringify({ status: nextStatus }) });
      mergeProjectSummary(data.project);
      selectProject(data.project, state.currentDetail ? Object.assign({}, state.currentDetail, { project: data.project }) : { project: data.project, recentLeads: [], recentMembers: [] });
      showToast(nextStatus === 'published' ? 'Website live holatga chiqarildi.' : 'Website draft holatiga qaytdi.', 'success');
    } catch (error) {
      showToast(error.message || 'Publish holati yangilanmadi.', 'error');
    } finally {
      setButtonLoading(els.togglePublishBtn, false);
    }
  }

  async function deleteProject(projectId) {
    const id = String(projectId || state.currentProject && state.currentProject.id || '').trim();
    if (!id) return;
    const target = state.projects.find((item) => String(item.id) === id);
    if (!window.confirm(`${target && target.startupName ? target.startupName : 'Website'} loyihasini o'chirasizmi?`)) return;
    try {
      const button = String(state.currentProject && state.currentProject.id || '') === id ? els.deleteProjectBtn : null;
      if (button) setButtonLoading(button, true, '<i class="fa-solid fa-spinner fa-spin"></i> O\'chirilmoqda...');
      await api(`/api/websites/${encodeURIComponent(id)}`, { method: 'DELETE' });
      state.projects = state.projects.filter((item) => String(item.id) !== id);
      if (state.currentProject && String(state.currentProject.id) === id) {
        state.currentProject = null;
        state.currentDetail = null;
      }
      renderProjectList();
      if (state.projects[0]) await openProject(state.projects[0].id);
      else selectProject(null, null);
      showToast('Website loyihasi o\'chirildi.', 'success');
    } catch (error) {
      showToast(error.message || 'Website o\'chirilmadi.', 'error');
    } finally {
      setButtonLoading(els.deleteProjectBtn, false);
    }
  }

  async function copyPublishedUrl() {
    const project = state.currentProject;
    if (!project || !project.publishedUrl) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(project.publishedUrl);
      } else {
        const helper = document.createElement('textarea');
        helper.value = project.publishedUrl;
        helper.setAttribute('readonly', 'readonly');
        helper.style.position = 'absolute';
        helper.style.left = '-9999px';
        document.body.appendChild(helper);
        helper.select();
        document.execCommand('copy');
        document.body.removeChild(helper);
      }
      showToast(project.status === 'published' ? 'Published URL nusxalandi.' : 'Subdomain URL nusxalandi. Live ishlashi uchun avval publish qiling.', 'success');
    } catch (error) {
      showToast(error.message || 'URL nusxalanmadi.', 'error');
    }
  }

  function openPreview() {
    const project = state.currentProject;
    if (!project) return;
    const url = pagePreviewUrl(project, state.currentPage) || project.previewUrl;
    if (!url) {
      showToast('Preview URL topilmadi.', 'error');
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = `/login.html?next=${encodeURIComponent(DEFAULT_NEXT)}`;
  }

  async function initSession() {
    if (!state.token) {
      window.location.href = `/login.html?next=${encodeURIComponent(DEFAULT_NEXT)}`;
      return;
    }
    const me = await api('/api/me');
    state.me = me.user || me;
    const fullName = String(state.me.fullName || state.me.fullname || state.me.username || 'Foydalanuvchi').trim();
    const role = String(state.me.role || 'student').trim().toLowerCase();
    const dashboardPath = normalizeNextPath(state.qs.get('next')) || dashboardPathForRole(role);
    if (els.welcomeLine) els.welcomeLine.textContent = `${fullName} uchun startup competition-ready website builder tayyor.`;
    if (els.dashboardLink) els.dashboardLink.href = dashboardPath;
  }

  function bindEvents() {
    syncThemeButton();
    renderTemplateOptions();
    renderPageSwitcher();
    renderPlaceholderFrame();
    renderStats();
    syncActionButtons();

    if (els.themeToggleBtn) els.themeToggleBtn.addEventListener('click', toggleTheme);
    if (els.logoutBtn) els.logoutBtn.addEventListener('click', logout);
    if (els.projectForm) els.projectForm.addEventListener('submit', handleGenerate);
    if (els.refreshProjectsBtn) {
      els.refreshProjectsBtn.addEventListener('click', function () {
        loadProjects().catch((error) => showToast(error.message || 'Website list yuklanmadi.', 'error'));
      });
    }
    if (els.demoProjectBtn) els.demoProjectBtn.addEventListener('click', fillDemoProject);
    if (els.resetFormBtn) els.resetFormBtn.addEventListener('click', resetForm);
    if (els.copyPublishedBtn) els.copyPublishedBtn.addEventListener('click', copyPublishedUrl);
    if (els.openPreviewBtn) els.openPreviewBtn.addEventListener('click', openPreview);
    if (els.togglePublishBtn) els.togglePublishBtn.addEventListener('click', handlePublishToggle);
    if (els.deleteProjectBtn) {
      els.deleteProjectBtn.addEventListener('click', function () {
        deleteProject().catch((error) => showToast(error.message || 'Website o\'chirilmadi.', 'error'));
      });
    }

    if (els.startupNameInput) {
      els.startupNameInput.addEventListener('input', function () {
        if (!state.slugDirty || !String(els.slugInput.value || '').trim()) {
          els.slugInput.value = slugify(els.startupNameInput.value);
        }
      });
    }

    if (els.slugInput) {
      els.slugInput.addEventListener('input', function () {
        const normalized = slugify(els.slugInput.value);
        state.slugDirty = !!normalized;
        if (normalized !== els.slugInput.value) {
          const start = els.slugInput.selectionStart;
          els.slugInput.value = normalized;
          if (typeof start === 'number') {
            const nextPos = Math.min(start, normalized.length);
            els.slugInput.setSelectionRange(nextPos, nextPos);
          }
        }
      });
    }
  }

  async function init() {
    bindEvents();
    await initSession();
    if (state.qs.get('demo') === '1' || state.qs.get('fresh') === '1') fillDemoProject();
    await loadProjects();
  }

  init().catch((error) => {
    console.error('website-studio init error:', error);
    showToast(error.message || 'Website Studio ishga tushmadi.', 'error');
  });
})();
