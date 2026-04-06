(function () {
  if (window.__schatGlobalLoaderReady) return;
  window.__schatGlobalLoaderReady = true;

  var doc = document;
  var state = {
    pending: 0,
    booting: true,
    manualBlocks: 0,
    overlay: null,
    settleTimer: null,
    maxBootTimer: null,
    minVisibleUntil: Date.now() + 700
  };

  function injectStyle() {
    if (doc.getElementById('schat-global-loader-style')) return;
    var style = doc.createElement('style');
    style.id = 'schat-global-loader-style';
    style.textContent = [
      '#schatGlobalLoader{visibility:visible!important;opacity:1!important;position:fixed;right:18px;bottom:18px;z-index:2147483646;display:none;align-items:center;justify-content:center;width:min(250px,calc(100vw - 36px));pointer-events:none;}',
      '#schatGlobalLoader.visible{display:flex}',
      '.schat-loader-card{width:100%;padding:10px 12px;border-radius:18px;border:1px solid rgba(13,38,35,.10);background:rgba(255,255,255,.92);box-shadow:0 18px 40px rgba(8,31,29,.12);color:#10332f;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;backdrop-filter:blur(14px)}',
      'html.dark .schat-loader-card{background:rgba(8,28,30,.94);border-color:rgba(255,255,255,.10);color:#e7fbf7}',
      '.schat-loader-line{display:flex;align-items:center;gap:10px}',
      '.schat-loader-badge{min-width:36px;height:36px;border-radius:12px;display:grid;place-items:center;font-weight:900;font-size:11px;color:#fff;background:linear-gradient(135deg,#14b8a6,#f59e0b);box-shadow:0 12px 28px rgba(20,184,166,.18)}',
      '.schat-loader-copy strong{display:block;font-size:13px;line-height:1.2;margin:0 0 2px}',
      '.schat-loader-copy p{margin:0;font-size:11px;line-height:1.45;color:rgba(16,51,47,.72)}',
      'html.dark .schat-loader-copy p{color:rgba(231,251,247,.72)}',
      '.schat-loader-dots{display:inline-flex;gap:5px;margin-top:10px}',
      '.schat-loader-dots span{width:7px;height:7px;border-radius:999px;background:rgba(15,143,131,.28);animation:schatLoaderBounce 1.1s infinite ease-in-out}',
      '.schat-loader-dots span:nth-child(2){animation-delay:.14s}',
      '.schat-loader-dots span:nth-child(3){animation-delay:.28s}',
      '@media (max-width:640px){#schatGlobalLoader{right:12px;left:12px;bottom:12px;width:auto}}',
      '@keyframes schatLoaderBounce{0%,80%,100%{transform:translateY(0);opacity:.42}40%{transform:translateY(-5px);opacity:1}}',
    ].join('');
    doc.head.appendChild(style);
  }

  function ensureUi() {
    if (!doc.body) return;
    if (!state.overlay) {
      state.overlay = doc.createElement('div');
      state.overlay.id = 'schatGlobalLoader';
      state.overlay.innerHTML = [
        '<div class="schat-loader-card">',
        '  <div class="schat-loader-line">',
        '    <div class="schat-loader-badge">AI</div>',
        '    <div class="schat-loader-copy">',
        '      <strong id="schatGlobalLoaderTitle">Sahifa yuklanmoqda</strong>',
        '      <p id="schatGlobalLoaderText">Ma\'lumotlar tayyorlanmoqda. Iltimos, bir necha soniya kuting.</p>',
        '    </div>',
        '  </div>',
        '  <div class="schat-loader-dots"><span></span><span></span><span></span></div>',
        '</div>'
      ].join('');
      doc.body.appendChild(state.overlay);
    }
  }

  function setMessage(title, text) {
    ensureUi();
    var titleEl = doc.getElementById('schatGlobalLoaderTitle');
    var textEl = doc.getElementById('schatGlobalLoaderText');
    if (titleEl && title) titleEl.textContent = String(title);
    if (textEl && text) textEl.textContent = String(text);
  }

  function showOverlay(title, text) {
    ensureUi();
    setMessage(title || 'Sahifa yuklanmoqda', text || 'Ma\'lumotlar tayyorlanmoqda. Iltimos, bir necha soniya kuting.');
    if (state.overlay) state.overlay.classList.add('visible');
  }

  function hideOverlayIfAllowed() {
    if (state.booting || state.manualBlocks > 0) return;
    if (state.overlay) state.overlay.classList.remove('visible');
  }

  function scheduleProgressBar(label) {
    window.setTimeout(function () {
      if (!state.booting && state.pending > 0) {
        showOverlay(label || 'Yuklanmoqda...', 'Sahifadagi ma’lumotlar yangilanmoqda.');
      }
    }, 180);
  }

  function settleBoot() {
    clearTimeout(state.settleTimer);
    state.settleTimer = setTimeout(function () {
      if (state.pending > 0) return;
      if (doc.readyState !== 'complete') return;
      if (Date.now() < state.minVisibleUntil) {
        settleBoot();
        return;
      }
      state.booting = false;
      hideOverlayIfAllowed();
    }, 220);
  }

  function finishTrackedRequest() {
    state.pending = Math.max(0, Number(state.pending || 0) - 1);
    if (state.pending === 0) {
      settleBoot();
    }
  }

  function shouldTrack(url) {
    var raw = String(url || '');
    if (!raw) return true;
    return raw.indexOf('/socket.io/') === -1;
  }

  function beginTrackedRequest(url) {
    if (!shouldTrack(url)) return function () {};
    state.pending += 1;
    if (state.booting) showOverlay('Sahifa yuklanmoqda', 'Kontentlar, guruhlar va profilingiz ma\'lumotlari tayyorlanmoqda.');
    else scheduleProgressBar('Yuklanmoqda...');
    return finishTrackedRequest;
  }

  function patchFetch() {
    if (typeof window.fetch !== 'function' || window.__schatLoaderFetchPatched) return;
    window.__schatLoaderFetchPatched = true;
    var originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = '';
      try {
        url = typeof input === 'string' ? input : (input && input.url) || '';
      } catch (_) {}
      var done = beginTrackedRequest(url);
      return originalFetch(input, init).then(function (response) {
        done();
        return response;
      }, function (error) {
        done();
        throw error;
      });
    };
  }

  function patchXhr() {
    if (!window.XMLHttpRequest || window.__schatLoaderXhrPatched) return;
    window.__schatLoaderXhrPatched = true;
    var open = XMLHttpRequest.prototype.open;
    var send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__schatTrackUrl = url;
      return open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var xhr = this;
      var done = beginTrackedRequest(xhr.__schatTrackUrl || '');
      xhr.addEventListener('loadend', done, { once: true });
      return send.apply(xhr, arguments);
    };
  }

  function exposeApi() {
    window.SchatLoading = {
      show: function (title, text) {
        state.manualBlocks += 1;
        showOverlay(title || 'Yuklanmoqda', text || 'Jarayon davom etmoqda...');
      },
      hide: function () {
        state.manualBlocks = Math.max(0, Number(state.manualBlocks || 0) - 1);
        if (state.manualBlocks === 0 && !state.booting && state.pending === 0) {
          hideOverlayIfAllowed();
        }
      },
      setText: function (title, text) {
        setMessage(title, text);
      }
    };
  }

  injectStyle();
  patchFetch();
  patchXhr();
  exposeApi();

  var bodyTimer = setInterval(function () {
    if (!doc.body) return;
    clearInterval(bodyTimer);
    ensureUi();
    showOverlay('Sahifa yuklanmoqda', 'Ma\'lumotlar tayyorlanmoqda. Iltimos, bir necha soniya kuting.');
  }, 20);

  window.addEventListener('load', settleBoot, { passive: true });
  state.maxBootTimer = setTimeout(function () {
    state.booting = false;
    hideOverlayIfAllowed();
  }, 12000);
})();
