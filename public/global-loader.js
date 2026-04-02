(function () {
  if (window.__schatGlobalLoaderReady) return;
  window.__schatGlobalLoaderReady = true;

  var doc = document;
  var root = doc.documentElement;
  var state = {
    pending: 0,
    booting: true,
    manualBlocks: 0,
    overlay: null,
    progress: null,
    progressInner: null,
    progressTimer: null,
    settleTimer: null,
    maxBootTimer: null,
    minVisibleUntil: Date.now() + 700
  };

  root.classList.add('schat-page-loading');

  function injectStyle() {
    if (doc.getElementById('schat-global-loader-style')) return;
    var style = doc.createElement('style');
    style.id = 'schat-global-loader-style';
    style.textContent = [
      'html.schat-page-loading body > *{opacity:0!important;visibility:hidden!important}',
      'html.schat-page-loading body > script{display:none!important}',
      '#schatGlobalLoader,#schatGlobalLoaderBar{visibility:visible!important;opacity:1!important}',
      '#schatGlobalLoader{position:fixed;inset:0;z-index:2147483646;display:none;align-items:center;justify-content:center;padding:24px;',
      'background:radial-gradient(circle at top,rgba(20,184,166,.18),transparent 34%),linear-gradient(180deg,rgba(3,12,19,.88),rgba(7,18,28,.94));',
      'backdrop-filter:blur(12px)}',
      '#schatGlobalLoader.visible{display:flex}',
      '.schat-loader-card{width:min(460px,92vw);padding:28px 26px;border-radius:24px;border:1px solid rgba(255,255,255,.16);',
      'background:linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,.08));box-shadow:0 30px 90px rgba(0,0,0,.34);',
      'color:#ecfeff;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}',
      '.schat-loader-line{display:flex;align-items:center;gap:14px}',
      '.schat-loader-badge{min-width:54px;height:54px;border-radius:18px;display:grid;place-items:center;font-weight:900;font-size:13px;color:#fff;',
      'background:linear-gradient(135deg,#14b8a6,#f59e0b);box-shadow:0 18px 44px rgba(20,184,166,.24)}',
      '.schat-loader-copy strong{display:block;font-size:18px;line-height:1.2;margin:0 0 6px}',
      '.schat-loader-copy p{margin:0;font-size:13px;line-height:1.6;color:rgba(236,254,255,.78)}',
      '.schat-loader-dots{display:inline-flex;gap:8px;margin-top:18px}',
      '.schat-loader-dots span{width:10px;height:10px;border-radius:999px;background:rgba(255,255,255,.24);animation:schatLoaderBounce 1.1s infinite ease-in-out}',
      '.schat-loader-dots span:nth-child(2){animation-delay:.14s}',
      '.schat-loader-dots span:nth-child(3){animation-delay:.28s}',
      '.schat-loader-bar{margin-top:18px;height:7px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;border:1px solid rgba(255,255,255,.08)}',
      '.schat-loader-bar i{display:block;height:100%;width:42%;border-radius:inherit;background:linear-gradient(90deg,#14b8a6,#facc15,#f59e0b);animation:schatLoaderSweep 1.25s infinite ease-in-out}',
      '#schatGlobalLoaderBar{position:fixed;left:18px;right:18px;top:14px;z-index:2147483645;display:none;align-items:center;gap:10px;',
      'padding:10px 14px;border-radius:999px;border:1px solid rgba(13,38,35,.12);background:rgba(255,255,255,.92);box-shadow:0 14px 44px rgba(10,35,32,.12);',
      'font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#10332f}',
      'html.dark #schatGlobalLoaderBar{background:rgba(8,28,30,.92);border-color:rgba(255,255,255,.1);color:#dffaf5}',
      '#schatGlobalLoaderBar.visible{display:flex}',
      '.schat-progress-track{flex:1;height:6px;border-radius:999px;overflow:hidden;background:rgba(15,143,131,.12)}',
      '.schat-progress-track i{display:block;height:100%;width:38%;border-radius:inherit;background:linear-gradient(90deg,#14b8a6,#f59e0b);animation:schatLoaderSweep 1.25s infinite ease-in-out}',
      '.schat-progress-label{font-size:12px;font-weight:800;letter-spacing:.02em;white-space:nowrap}',
      '@keyframes schatLoaderBounce{0%,80%,100%{transform:translateY(0);opacity:.42}40%{transform:translateY(-5px);opacity:1}}',
      '@keyframes schatLoaderSweep{0%{transform:translateX(-120%)}100%{transform:translateX(290%)}}'
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
        '  <div class="schat-loader-bar"><i></i></div>',
        '</div>'
      ].join('');
      doc.body.appendChild(state.overlay);
    }
    if (!state.progress) {
      state.progress = doc.createElement('div');
      state.progress.id = 'schatGlobalLoaderBar';
      state.progress.innerHTML = '<span class="schat-progress-label" id="schatGlobalProgressLabel">Yuklanmoqda...</span><div class="schat-progress-track"><i></i></div>';
      doc.body.appendChild(state.progress);
      state.progressInner = state.progress.querySelector('.schat-progress-track i');
    }
  }

  function setMessage(title, text) {
    ensureUi();
    var titleEl = doc.getElementById('schatGlobalLoaderTitle');
    var textEl = doc.getElementById('schatGlobalLoaderText');
    var progressLabel = doc.getElementById('schatGlobalProgressLabel');
    if (titleEl && title) titleEl.textContent = String(title);
    if (textEl && text) textEl.textContent = String(text);
    if (progressLabel) progressLabel.textContent = String(title || 'Yuklanmoqda...');
  }

  function showOverlay(title, text) {
    ensureUi();
    setMessage(title || 'Sahifa yuklanmoqda', text || 'Ma\'lumotlar tayyorlanmoqda. Iltimos, bir necha soniya kuting.');
    if (state.overlay) state.overlay.classList.add('visible');
    root.classList.add('schat-page-loading');
  }

  function hideOverlayIfAllowed() {
    if (state.booting || state.manualBlocks > 0) return;
    if (state.overlay) state.overlay.classList.remove('visible');
    root.classList.remove('schat-page-loading');
  }

  function showProgressBar(label) {
    ensureUi();
    var progressLabel = doc.getElementById('schatGlobalProgressLabel');
    if (progressLabel) progressLabel.textContent = String(label || 'Yuklanmoqda...');
    if (state.progress) state.progress.classList.add('visible');
  }

  function hideProgressBar() {
    if (state.progress) state.progress.classList.remove('visible');
  }

  function scheduleProgressBar(label) {
    clearTimeout(state.progressTimer);
    state.progressTimer = setTimeout(function () {
      if (!state.booting && state.pending > 0) showProgressBar(label);
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
      hideProgressBar();
    }, 220);
  }

  function finishTrackedRequest() {
    state.pending = Math.max(0, Number(state.pending || 0) - 1);
    if (state.pending === 0) {
      clearTimeout(state.progressTimer);
      hideProgressBar();
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
          hideProgressBar();
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
    hideProgressBar();
  }, 12000);
})();
