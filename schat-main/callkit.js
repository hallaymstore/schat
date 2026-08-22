/**
 * Global CallKit (minimal)
 * - Put this file into /public/callkit.js (or serve it) and include:
 *   <script src="/socket.io/socket.io.js"></script>
 *   <script src="/callkit.js"></script>
 *
 * Purpose:
 * - Any page: show incoming call toast and allow redirect to chat page for answering.
 */
(function () {
  const TOKEN_KEY = 'token';
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;

  // Avoid double-initialization (multiple script loads)
  if (window.__SCHAT_CALLKIT__) return;
  window.__SCHAT_CALLKIT__ = true;

  const socket = io({ transports: ['websocket', 'polling'] });

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function showToast(payload) {
    const wrap = el('div', 'callkit-toast');
    wrap.innerHTML = `
      <div class="callkit-card">
        <div class="callkit-left">
          <img class="callkit-avatar" src="${payload.avatar || ''}" alt="">
          <div>
            <div class="callkit-title">Qo‘ng‘iroq</div>
            <div class="callkit-sub">${payload.name || 'Noma’lum'} — ${payload.type === 'video' ? 'Video' : 'Audio'}</div>
          </div>
        </div>
        <div class="callkit-actions">
          <button class="callkit-btn callkit-accept">Qabul</button>
          <button class="callkit-btn callkit-reject">Rad</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    wrap.querySelector('.callkit-accept').onclick = () => {
      try {
        localStorage.setItem('incomingCall:' + payload.from, JSON.stringify({
          offer: payload.offer,
          ts: Date.now(),
          type: payload.type,
          callId: payload.callId || null,
          callerInfo: payload.callerInfo || null,
          callerName: payload.name || null,
          callerAvatar: payload.avatar || null,
        }));
      } catch(e) {}

      // Open chat page for that user
      window.location.href = `/chat.html?user=${encodeURIComponent(payload.from)}`;
    };

    wrap.querySelector('.callkit-reject').onclick = () => {
      socket.emit('callRejected', { to: payload.from, callId: payload.callId || null });
      wrap.remove();
    };

    // Auto hide after 45s
    setTimeout(() => { try { wrap.remove(); } catch(e){} }, 45000);
  }

  // Minimal styles (doesn't depend on Tailwind)
  const style = el('style');
  style.textContent = `
    .callkit-toast{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99999;width:min(520px,calc(100vw - 24px));}
    .callkit-card{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px 14px;border-radius:16px;background:rgba(17,24,39,.86);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.10);box-shadow:0 18px 50px rgba(0,0,0,.45);color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;}
    .callkit-left{display:flex;gap:10px;align-items:center;min-width:0}
    .callkit-avatar{width:42px;height:42px;border-radius:12px;object-fit:cover;background:rgba(255,255,255,.08)}
    .callkit-title{font-weight:700;font-size:14px;line-height:1.1}
    .callkit-sub{opacity:.85;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px}
    .callkit-actions{display:flex;gap:8px;flex:0 0 auto}
    .callkit-btn{border:none;border-radius:12px;padding:10px 12px;color:#fff;cursor:pointer;font-weight:700;font-size:12px}
    .callkit-accept{background:rgba(34,197,94,.95)}
    .callkit-reject{background:rgba(239,68,68,.92)}
  `;
  document.head.appendChild(style);

  socket.on('connect', () => {
    socket.emit('authenticate', token);
  });

  socket.on('callOffer', (data) => {
    // data: { from, offer, type, callerInfo{...} }
    const name = data?.callerInfo?.nickname || 'Noma’lum';
    const avatar = data?.callerInfo?.avatar || '';
    const callId = data?.callerInfo?.callId || data?.callId || null;
    showToast({ from: data.from, offer: data.offer, type: data.type, name, avatar, callId, callerInfo: data.callerInfo });
  });
})();
