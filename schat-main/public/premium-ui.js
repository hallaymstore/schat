(function () {
  if (window.HallaymPremiumUi) return;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isUserVerified(user) {
    return !!(user && user.verified);
  }

  function isPremiumActive(user) {
    return !!(user && user.premium && user.premium.active && user.premium.active.user);
  }

  function displayName(user, fallback) {
    return String(
      (user && (user.fullName || user.nickname || user.username))
      || fallback
      || 'Foydalanuvchi'
    );
  }

  function renderBadges(user, options) {
    const safeOptions = Object.assign({ compact: false, showPremium: true }, options || {});
    const out = [];
    if (isUserVerified(user)) {
      out.push('<span class="hallaym-badge hallaym-badge-verified" title="Tasdiqlangan profil"><i class="fa-solid fa-badge-check"></i><span>Verified</span></span>');
    }
    if (safeOptions.showPremium && isPremiumActive(user)) {
      out.push('<span class="hallaym-badge hallaym-badge-premium" title="Premium obuna faol"><i class="fa-solid fa-sparkles"></i><span>Premium</span></span>');
    }
    return out.join('');
  }

  function renderNameWithBadges(user, options) {
    const safeOptions = Object.assign({ fallback: 'Foydalanuvchi', compact: false, showPremium: true }, options || {});
    const name = escapeHtml(displayName(user, safeOptions.fallback));
    const badges = renderBadges(user, safeOptions);
    return `<span class="hallaym-name-line${safeOptions.compact ? ' compact' : ''}"><span class="hallaym-name-text">${name}</span>${badges ? `<span class="hallaym-badge-row">${badges}</span>` : ''}</span>`;
  }

  function injectStyle() {
    if (document.getElementById('hallaymPremiumUiStyle')) return;
    const style = document.createElement('style');
    style.id = 'hallaymPremiumUiStyle';
    style.textContent = `
      .hallaym-name-line{
        display:inline-flex;
        align-items:center;
        gap:10px;
        flex-wrap:wrap;
      }
      .hallaym-name-line.compact{
        gap:8px;
      }
      .hallaym-name-text{
        font-weight:800;
        letter-spacing:-0.02em;
      }
      .hallaym-badge-row{
        display:inline-flex;
        align-items:center;
        gap:6px;
        flex-wrap:wrap;
      }
      .hallaym-badge{
        display:inline-flex;
        align-items:center;
        gap:6px;
        padding:6px 10px;
        border-radius:999px;
        border:1px solid rgba(15,111,102,.18);
        font-size:11px;
        font-weight:900;
        letter-spacing:.04em;
        text-transform:uppercase;
        line-height:1;
        box-shadow:0 8px 18px rgba(9,42,38,.08);
      }
      .hallaym-badge i{
        font-size:11px;
      }
      .hallaym-badge-verified{
        background:rgba(15,143,131,.12);
        color:#0f6f66;
      }
      .hallaym-badge-premium{
        background:rgba(245,158,11,.14);
        color:#9a6500;
        border-color:rgba(245,158,11,.22);
      }
      html.dark .hallaym-badge-verified{
        background:rgba(45,212,191,.14);
        color:#88f1e6;
        border-color:rgba(45,212,191,.22);
      }
      html.dark .hallaym-badge-premium{
        background:rgba(251,191,36,.16);
        color:#ffd978;
        border-color:rgba(251,191,36,.22);
      }
    `;
    document.head.appendChild(style);
  }

  injectStyle();

  window.HallaymPremiumUi = {
    escapeHtml,
    displayName,
    isUserVerified,
    isPremiumActive,
    renderBadges,
    renderNameWithBadges
  };
})();
