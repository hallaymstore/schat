const TEMPLATE_PRESETS = [
  {
    id: 'startup-pitch',
    label: 'Startup Pitch',
    mood: 'Investor va tanlov uchun premium pitch landing',
    summary: 'Qisqa, ishonchli va CTA markazli sahifa.'
  },
  {
    id: 'edtech-launch',
    label: 'EdTech Launch',
    mood: 'Ta\'lim va community startup uchun yorqin korinish',
    summary: 'Course, mentorship va registration oqimi bilan.'
  },
  {
    id: 'marketplace-lite',
    label: 'Marketplace Lite',
    mood: 'Service/product showcase va lead yig\'ish uchun',
    summary: 'Catalog emas, lekin kuchli CTA va benefit bloklari bilan.'
  },
  {
    id: 'saas-beta',
    label: 'SaaS Beta',
    mood: 'Product waitlist, login va dashboard preview bilan',
    summary: 'B2B/B2C beta launch uchun minimal stack.'
  }
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeSlug(value) {
  const raw = String(value || '').trim().toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug || 'startup-site';
}

function normalizePageSlug(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'register' || raw === 'login' || raw === 'account') return raw;
  return 'index';
}

function normalizeOrigin(origin) {
  return String(origin || '').trim().replace(/\/+$/, '');
}

function buildWebsiteLinks(slug, options = {}) {
  const safeSlug = normalizeSlug(slug);
  const origin = normalizeOrigin(options.origin || '');
  const previewBase = `/site-preview/${safeSlug}`;
  const publishedBase = `/site/${safeSlug}`;
  const wildcardUrl = `https://${safeSlug}.edu.hallaym.site`;
  const withOrigin = (path) => origin ? `${origin}${path}` : path;
  return {
    slug: safeSlug,
    origin,
    previewBase,
    previewUrl: withOrigin(previewBase),
    registerPreviewUrl: withOrigin(`${previewBase}/register`),
    loginPreviewUrl: withOrigin(`${previewBase}/login`),
    accountPreviewUrl: withOrigin(`${previewBase}/account`),
    publishedBase,
    publishedUrl: withOrigin(publishedBase),
    registerPublishedUrl: withOrigin(`${publishedBase}/register`),
    loginPublishedUrl: withOrigin(`${publishedBase}/login`),
    accountPublishedUrl: withOrigin(`${publishedBase}/account`),
    wildcardUrl
  };
}

function buildPageHref(routeBase, pageSlug) {
  const base = String(routeBase || '').trim().replace(/\/+$/, '');
  if (!pageSlug || pageSlug === 'index') return base ? `${base}/` : '/';
  return base ? `${base}/${pageSlug}` : `/${pageSlug}`;
}

function sectionCards(section = {}) {
  const items = Array.isArray(section.items) ? section.items : [];
  if (!items.length) return '';
  return `
    <section class="panel section">
      <div class="section-head">
        <span class="eyebrow">${escapeHtml(section.kicker || section.type || 'HALLAYM')}</span>
        <h2>${escapeHtml(section.title || 'Bo\'lim')}</h2>
        <p>${escapeHtml(section.subtitle || '')}</p>
      </div>
      <div class="card-grid">
        ${items.map((item) => `
          <article class="info-card">
            ${item.value ? `<div class="metric-value">${escapeHtml(item.value)}</div>` : ''}
            <h3>${escapeHtml(item.title || item.label || 'Punkt')}</h3>
            <p>${escapeHtml(item.body || item.detail || item.quote || '')}</p>
            ${item.meta ? `<span class="card-meta">${escapeHtml(item.meta)}</span>` : ''}
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function renderIndexPage(project, nav = {}) {
  const metrics = Array.isArray(project.metrics) ? project.metrics : [];
  const highlights = Array.isArray(project.highlights) ? project.highlights : [];
  const sections = Array.isArray(project.sections) ? project.sections : [];
  const feature = project.serverFeatures || {};
  const registerHref = feature.authEnabled ? (nav.registerHref || '/register') : '#contact-form';
  const loginHref = feature.authEnabled ? (nav.loginHref || '/login') : '#benefits';
  const contactHref = nav.contactHref || '#contact-form';
  return `
    <section class="hero panel">
      <div class="hero-copy">
        <span class="eyebrow">${escapeHtml(project.kicker || 'HALLAYM AI website')}</span>
        <h1>${escapeHtml(project.heroTitle || project.startupName || 'Startup landing')}</h1>
        <p>${escapeHtml(project.heroSubtitle || project.summary || '')}</p>
        <div class="actions">
          <a class="btn primary" href="${escapeHtml(registerHref)}">${escapeHtml(project.ctaPrimary || 'Boshlash')}</a>
          <a class="btn" href="${escapeHtml(loginHref)}">${escapeHtml(project.ctaSecondary || 'Batafsil')}</a>
        </div>
        <div class="hero-badges">
          ${highlights.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
        </div>
      </div>
      <div class="hero-card">
        <div class="mock-window">
          <div class="mock-top"><span></span><span></span><span></span></div>
          <div class="mock-body">
            <h3>${escapeHtml(project.startupName || 'Startup')}</h3>
            <p>${escapeHtml(project.heroCardTitle || 'Competition-ready product page')}</p>
            <ul>
              ${(project.heroChecklist || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
            </ul>
          </div>
        </div>
      </div>
    </section>

    ${metrics.length ? `
      <section class="panel metrics">
        ${metrics.map((item) => `
          <article class="metric-card">
            <strong>${escapeHtml(item.value || '0')}</strong>
            <span>${escapeHtml(item.label || '')}</span>
          </article>
        `).join('')}
      </section>
    ` : ''}

    <div id="benefits"></div>
    ${sections.map((section) => sectionCards(section)).join('')}

    <section class="panel section cta-band">
      <div>
        <span class="eyebrow">Launch now</span>
        <h2>${escapeHtml(project.finalCtaTitle || `${project.startupName || 'Startup'} uchun landing tayyor`)}</h2>
        <p>${escapeHtml(project.finalCtaBody || 'Ro\'yxatdan o\'tish, login va lead yig\'ish oqimi shu saytda ishlaydi.')}</p>
      </div>
      <div class="actions">
        <a class="btn primary" href="${escapeHtml(registerHref)}">${escapeHtml(project.finalCtaPrimary || 'Akkaunt ochish')}</a>
        ${feature.contactEnabled || feature.waitlistEnabled ? `<a class="btn" href="${escapeHtml(contactHref)}">${escapeHtml(project.finalCtaSecondary || 'Aloqa qoldirish')}</a>` : ''}
      </div>
    </section>

    ${feature.contactEnabled || feature.waitlistEnabled ? `
      <section class="panel section">
        <div class="section-head">
          <span class="eyebrow">Server function</span>
          <h2>${escapeHtml(feature.waitlistEnabled ? (project.waitlistTitle || 'Waitlist va lead yig\'ish') : (project.contactTitle || 'Biz bilan bog\'laning'))}</h2>
          <p>${escapeHtml(feature.waitlistEnabled ? (project.waitlistPrompt || 'Qiziqqan foydalanuvchilarni bazaga yig\'ing.') : (project.contactPrompt || 'Mijozlar sizga xabar qoldirishi mumkin.'))}</p>
        </div>
        <form class="site-form" id="contact-form" data-site-form="${feature.waitlistEnabled ? 'waitlist' : 'contact'}">
          <input type="text" name="name" placeholder="Ism yoki jamoa nomi" required />
          <input type="email" name="email" placeholder="Email" required />
          <input type="text" name="company" placeholder="Startup / tashkilot" />
          <textarea name="message" rows="4" placeholder="${escapeHtml(feature.waitlistEnabled ? 'Qanday startup ustida ishlayapsiz?' : 'Xabaringizni yozing')}"></textarea>
          <button class="btn primary" type="submit">${escapeHtml(feature.waitlistEnabled ? 'Waitlistga qo\'shilish' : 'Xabar yuborish')}</button>
          <div class="form-note" data-form-note></div>
        </form>
      </section>
    ` : ''}
  `;
}

function renderAuthPage(project, pageSlug) {
  const isRegister = pageSlug === 'register';
  const copy = isRegister ? (project.registerCopy || {}) : (project.loginCopy || {});
  const benefits = Array.isArray(copy.benefits) ? copy.benefits : [];
  return `
    <section class="auth-shell">
      <div class="auth-side panel">
        <span class="eyebrow">${escapeHtml(project.kicker || 'HALLAYM AI website')}</span>
        <h1>${escapeHtml(copy.headline || (isRegister ? 'Ro\'yxatdan o\'ting' : 'Akkauntga kiring'))}</h1>
        <p>${escapeHtml(copy.subheadline || project.summary || '')}</p>
        <div class="hero-badges">
          ${benefits.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
        </div>
      </div>
      <form class="site-form panel" id="${isRegister ? 'register-form' : 'login-form'}">
        <h2>${escapeHtml(isRegister ? 'Yangi akkaunt' : 'Qayta kirish')}</h2>
        <p class="muted">${escapeHtml(copy.helper || 'Minimal auth oqimi HALLAYM site backend bilan ishlaydi.')}</p>
        ${isRegister ? '<input type="text" name="fullName" placeholder="Ism Familiya" required />' : ''}
        <input type="email" name="email" placeholder="Email" required />
        ${isRegister ? '<input type="text" name="company" placeholder="Startup / jamoa nomi" />' : ''}
        <input type="password" name="password" placeholder="Parol" required />
        <button class="btn primary" type="submit">${escapeHtml(isRegister ? 'Akkaunt ochish' : 'Kirish')}</button>
        <div class="form-note" data-form-note></div>
      </form>
    </section>
  `;
}

function renderAccountPage(project) {
  const checklist = Array.isArray(project.accountCopy?.checklist) ? project.accountCopy.checklist : [];
  return `
    <section class="panel section">
      <div class="section-head">
        <span class="eyebrow">${escapeHtml(project.kicker || 'Member area')}</span>
        <h1>${escapeHtml(project.accountCopy?.headline || 'A\'zo kabineti')}</h1>
        <p>${escapeHtml(project.accountCopy?.subheadline || 'Ro\'yxatdan o\'tgan foydalanuvchi uchun minimal account sahifasi.')}</p>
      </div>
      <div id="account-box" class="account-box">Ma'lumot yuklanmoqda...</div>
      ${checklist.length ? `
        <div class="card-grid" style="margin-top:18px">
          ${checklist.map((item) => `<article class="info-card"><h3>${escapeHtml(item)}</h3><p>Competition-ready ish rejasi shu account sahifada ko'rinadi.</p></article>`).join('')}
        </div>
      ` : ''}
    </section>
  `;
}

function renderWebsiteProjectHtml(project, options = {}) {
  const slug = normalizeSlug(project?.slug || project?.subdomain || 'startup-site');
  const links = buildWebsiteLinks(slug, { origin: options.origin || '' });
  const pageSlug = normalizePageSlug(options.pageSlug || 'index');
  const routeBase = typeof options.routeBase === 'string'
    ? String(options.routeBase || '').trim().replace(/\/+$/, '')
    : (options.preview ? links.previewBase : '');
  const basePrefix = routeBase;
  const palette = Object.assign({
    accent: '#14968b',
    accentSoft: '#6fd8cb',
    highlight: '#f0b348',
    dark: '#082026',
    surface: '#f6fcfb'
  }, project?.palette || {});
  const feature = Object.assign({ authEnabled: true, waitlistEnabled: true, contactEnabled: true }, project?.serverFeatures || {});
  const projectConfig = {
    slug,
    apiBase: `/api/website-builder/public/${slug}`,
    basePrefix,
    routeBase,
    publishedUrl: links.publishedUrl,
    wildcardUrl: links.wildcardUrl,
    authEnabled: !!feature.authEnabled,
    waitlistEnabled: !!feature.waitlistEnabled,
    contactEnabled: !!feature.contactEnabled
  };
  const nav = {
    homeHref: buildPageHref(routeBase, 'index'),
    registerHref: buildPageHref(routeBase, 'register'),
    loginHref: buildPageHref(routeBase, 'login'),
    accountHref: buildPageHref(routeBase, 'account'),
    contactHref: '#contact-form'
  };
  const bodyHtml = pageSlug === 'register' || pageSlug === 'login'
    ? renderAuthPage(project, pageSlug)
    : (pageSlug === 'account' ? renderAccountPage(project) : renderIndexPage(project, nav));

  return `<!doctype html>
<html lang="uz">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(project.seoTitle || project.startupName || 'HALLAYM website')}</title>
  <meta name="description" content="${escapeHtml(project.seoDescription || project.summary || '')}" />
  <style>
    :root{--accent:${escapeHtml(palette.accent)};--accent-soft:${escapeHtml(palette.accentSoft)};--highlight:${escapeHtml(palette.highlight)};--dark:${escapeHtml(palette.dark)};--surface:${escapeHtml(palette.surface)};--line:rgba(15,45,53,.12)}
    *{box-sizing:border-box}html,body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial;background:radial-gradient(circle at top left, color-mix(in srgb, var(--accent-soft) 34%, transparent), transparent 32%), radial-gradient(circle at bottom right, color-mix(in srgb, var(--highlight) 18%, transparent), transparent 28%), var(--surface);color:var(--dark)}
    a{color:inherit;text-decoration:none}img{max-width:100%;display:block}body{min-height:100vh}
    .shell{max-width:1220px;margin:0 auto;padding:0 18px}.topbar{position:sticky;top:0;z-index:30;background:color-mix(in srgb, #fff 78%, transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}.topbar .shell{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:16px 18px}
    .brand{display:flex;align-items:center;gap:12px}.mark{width:48px;height:48px;border-radius:18px;background:linear-gradient(135deg,var(--accent),var(--highlight));box-shadow:0 18px 42px rgba(7,30,36,.16)}.brand h1{margin:0;font-size:18px}.brand p{margin:2px 0 0;color:rgba(8,32,38,.68);font-size:13px}
    .nav-actions,.actions,.hero-badges{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 16px;border-radius:999px;border:1px solid var(--line);background:#fff;font-weight:800}.btn.primary{background:linear-gradient(135deg,var(--accent),var(--highlight));color:#fff;border-color:transparent}
    .layout{padding:28px 0 56px}.panel{background:color-mix(in srgb, #fff 94%, transparent);border:1px solid var(--line);border-radius:30px;box-shadow:0 22px 70px rgba(8,32,38,.10)}.hero{display:grid;grid-template-columns:1.1fr .9fr;gap:20px;padding:28px}.hero-copy h1{margin:12px 0 0;font-size:clamp(2.4rem,1.4rem + 3vw,4.8rem);line-height:.98}.hero-copy p{margin:14px 0 0;color:rgba(8,32,38,.72);font-size:18px;line-height:1.6}.hero-badges span,.eyebrow{display:inline-flex;padding:8px 12px;border-radius:999px;border:1px solid var(--line);background:color-mix(in srgb, var(--accent-soft) 16%, #fff);font-size:12px;font-weight:900}.hero-card{display:grid;place-items:center}.mock-window{width:100%;max-width:440px;border-radius:28px;background:linear-gradient(180deg,rgba(8,32,38,.95),rgba(10,44,50,.92));padding:18px;box-shadow:0 30px 80px rgba(7,30,36,.28)}.mock-top{display:flex;gap:8px}.mock-top span{width:12px;height:12px;border-radius:999px;background:rgba(255,255,255,.28)}.mock-body{margin-top:18px;border-radius:24px;background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.04));padding:18px;color:#fff}.mock-body h3{margin:0;font-size:28px}.mock-body p{margin:10px 0 0;color:rgba(255,255,255,.78)}.mock-body ul{margin:16px 0 0;padding-left:18px;display:grid;gap:8px}
    .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:16px;margin-top:18px}.metric-card{padding:18px;border-radius:22px;background:linear-gradient(180deg,color-mix(in srgb, var(--accent-soft) 16%, #fff),#fff);border:1px solid var(--line)}.metric-card strong{display:block;font-size:34px}.metric-card span{display:block;margin-top:6px;color:rgba(8,32,38,.62);font-weight:700}
    .section{padding:24px;margin-top:18px}.section-head h2{margin:12px 0 0;font-size:32px}.section-head p{margin:10px 0 0;color:rgba(8,32,38,.68);line-height:1.7}.card-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:18px}.info-card{padding:18px;border-radius:24px;background:color-mix(in srgb, var(--accent-soft) 8%, #fff);border:1px solid var(--line)}.info-card h3{margin:0;font-size:20px}.info-card p{margin:10px 0 0;color:rgba(8,32,38,.68);line-height:1.65}.metric-value{font-size:32px;font-weight:900}.card-meta{display:inline-flex;margin-top:12px;padding:6px 10px;border-radius:999px;background:color-mix(in srgb, var(--highlight) 14%, #fff);font-size:12px;font-weight:800}
    .cta-band{display:flex;align-items:center;justify-content:space-between;gap:16px}.site-form{display:grid;gap:12px}.site-form input,.site-form textarea{width:100%;padding:14px 16px;border-radius:18px;border:1px solid var(--line);background:#fff;font:inherit;color:var(--dark)}.form-note{font-size:13px;color:rgba(8,32,38,.70)}
    .auth-shell{display:grid;grid-template-columns:1fr .9fr;gap:18px}.auth-side{padding:28px}.auth-side h1{margin:12px 0 0;font-size:clamp(2.3rem,1.4rem + 2vw,3.8rem)}.auth-side p{margin-top:12px;color:rgba(8,32,38,.72);line-height:1.7}.account-box{padding:18px;border-radius:24px;background:color-mix(in srgb, var(--accent-soft) 10%, #fff);border:1px solid var(--line);font-size:18px;font-weight:700}
    .preview-banner{margin:18px auto 0;max-width:1220px;padding:0 18px}.preview-banner div{padding:12px 16px;border-radius:18px;background:linear-gradient(135deg,var(--accent),var(--highlight));color:#fff;font-weight:800}
    footer{padding:0 18px 36px;color:rgba(8,32,38,.58);text-align:center}.footer-inner{max-width:1220px;margin:0 auto;padding-top:18px}
    @media (max-width:980px){.hero,.auth-shell,.cta-band{grid-template-columns:1fr}.metrics,.card-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media (max-width:680px){.metrics,.card-grid{grid-template-columns:1fr}.topbar .shell{padding:14px 18px}.hero{padding:22px}.section{padding:20px}}
  </style>
</head>
<body>
  ${options.preview ? `<div class="preview-banner"><div>Preview mode: ${escapeHtml(links.publishedUrl)}</div></div>` : ''}
  <header class="topbar"><div class="shell"><div class="brand"><div class="mark"></div><div><h1>${escapeHtml(project.startupName || 'Startup site')}</h1><p>${escapeHtml(project.brandLine || project.summary || 'Built by HALLAYM AI')}</p></div></div><div class="nav-actions"><a class="btn" href="${escapeHtml(nav.homeHref)}">Home</a><a class="btn" href="${escapeHtml(nav.registerHref)}">Register</a><a class="btn" href="${escapeHtml(nav.loginHref)}">Login</a><a class="btn" href="${escapeHtml(nav.accountHref)}">Account</a></div></div></header>
  <main class="layout"><div class="shell">${bodyHtml}</div></main>
  <footer><div class="footer-inner">${escapeHtml(project.footerText || `${project.startupName || 'Startup'} powered by HALLAYM AI website studio`)}<div style="margin-top:8px">${escapeHtml(links.publishedUrl)}</div>${links.wildcardUrl ? `<div style="margin-top:6px;font-size:12px;opacity:.72">Wildcard alias: ${escapeHtml(links.wildcardUrl)}</div>` : ''}</div></footer>
  <script>
    window.__HALLAYM_SITE__ = ${JSON.stringify(projectConfig)};
    (function(){
      const cfg = window.__HALLAYM_SITE__;
      const tokenKey = 'hallaym_site_token_' + cfg.slug;
      const apiBase = cfg.apiBase;
      const noteOf = (form) => form ? form.querySelector('[data-form-note]') : null;
      const say = (form, message, ok) => { const box = noteOf(form); if(box){ box.textContent = message; box.style.color = ok ? '#0f8058' : '#9b2942'; } };
      const authHeaders = () => {
        const token = localStorage.getItem(tokenKey) || '';
        return token ? { Authorization: 'Bearer ' + token } : {};
      };
      async function postJson(url, body, headers) {
        const res = await fetch(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: JSON.stringify(body || {}) });
        const data = await res.json().catch(() => ({}));
        if(!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      }
      async function getJson(url, headers) {
        const res = await fetch(url, { headers: Object.assign({}, headers || {}) });
        const data = await res.json().catch(() => ({}));
        if(!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        return data;
      }
      const registerForm = document.getElementById('register-form');
      if(registerForm){
        registerForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          const form = new FormData(registerForm);
          try{
            const data = await postJson(apiBase + '/register', {
              fullName: form.get('fullName'),
              email: form.get('email'),
              company: form.get('company'),
              password: form.get('password')
            });
            localStorage.setItem(tokenKey, data.token || '');
            say(registerForm, 'Akkaunt yaratildi. Account sahifasiga yo\'naltirilmoqda.', true);
            setTimeout(() => location.href = cfg.basePrefix + '/account', 500);
          }catch(error){ say(registerForm, error.message || 'Akkaunt yaratilmadi.', false); }
        });
      }
      const loginForm = document.getElementById('login-form');
      if(loginForm){
        loginForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          const form = new FormData(loginForm);
          try{
            const data = await postJson(apiBase + '/login', { email: form.get('email'), password: form.get('password') });
            localStorage.setItem(tokenKey, data.token || '');
            say(loginForm, 'Kirish muvaffaqiyatli. Account sahifasi ochiladi.', true);
            setTimeout(() => location.href = cfg.basePrefix + '/account', 500);
          }catch(error){ say(loginForm, error.message || 'Kirish amalga oshmadi.', false); }
        });
      }
      const leadForm = document.querySelector('[data-site-form]');
      if(leadForm){
        leadForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          const form = new FormData(leadForm);
          const kind = leadForm.getAttribute('data-site-form') || 'contact';
          try{
            const data = await postJson(apiBase + '/' + kind, {
              name: form.get('name'),
              email: form.get('email'),
              company: form.get('company'),
              message: form.get('message')
            });
            leadForm.reset();
            say(leadForm, data.message || 'Ma\'lumot yuborildi.', true);
          }catch(error){ say(leadForm, error.message || 'Ma\'lumot yuborilmadi.', false); }
        });
      }
      const accountBox = document.getElementById('account-box');
      if(accountBox){
        const token = localStorage.getItem(tokenKey) || '';
        if(!token){
          accountBox.innerHTML = 'Avval login qiling yoki akkaunt yarating.';
        } else {
          getJson(apiBase + '/me', authHeaders())
            .then((data) => {
              const member = data.member || {};
              accountBox.innerHTML = '<strong>' + (member.fullName || member.email || 'Member') + '</strong><div style="margin-top:8px;font-size:14px;color:rgba(8,32,38,.68)">Email: ' + (member.email || '-') + '<br/>Company: ' + (member.company || '-') + '<br/>Status: Active member</div>';
            })
            .catch(() => {
              localStorage.removeItem(tokenKey);
              accountBox.innerHTML = 'Session tugagan. Iltimos, qayta login qiling.';
            });
        }
      }
    })();
  </script>
</body>
</html>`;
}

module.exports = {
  WEBSITE_TEMPLATE_PRESETS: TEMPLATE_PRESETS,
  buildWebsiteLinks,
  normalizeWebsiteRenderSlug: normalizeSlug,
  normalizeWebsiteRenderPageSlug: normalizePageSlug,
  renderWebsiteProjectHtml
};
