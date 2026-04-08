(function () {
  if (window.__schatGlobalLoaderReady) return;
  window.__schatGlobalLoaderReady = true;

  var doc = document;
  var CACHE_PREFIX = 'schat:get-cache:v2:';
  var CACHE_RULES = [
    { re: /^\/api\/me(?:[/?]|$)/, ttl: 30000 },
    { re: /^\/api\/groups(?:\/all|\/my|\/joined)?(?:[/?]|$)/, ttl: 25000 },
    { re: /^\/api\/channels(?:\/featured|\/stats)?(?:[/?]|$)/, ttl: 25000 },
    { re: /^\/api\/channels\/by-username\/[^/?]+(?:[/?]|$)/, ttl: 20000 },
    { re: /^\/api\/channels\/[0-9a-fA-F]{24}(?:\/posts)?(?:[/?]|$)/, ttl: 20000 },
    { re: /^\/api\/catalog(?:[/?]|$)/, ttl: 300000 }
  ];
  var state = {
    pending: 0,
    booting: true,
    manualBlocks: 0,
    overlay: null,
    settleTimer: null,
    showTimer: null,
    hideTimer: null,
    maxBootTimer: null,
    visible: false,
    minVisibleUntil: 0,
    requestCache: new Map()
  };

  function injectStyle() {
    if (doc.getElementById('schat-global-loader-style')) return;
    var style = doc.createElement('style');
    style.id = 'schat-global-loader-style';
    style.textContent = [
      '#schatGlobalLoader{position:fixed;inset:0;z-index:2147483646;display:none;align-items:center;justify-content:center;pointer-events:none;opacity:0;transition:opacity .16s ease;}',
      '#schatGlobalLoader.visible{display:flex;opacity:1;}',
      '.schat-loader-spinner{width:44px;height:44px;border-radius:999px;border:3px solid rgba(18,95,87,.18);border-top-color:#0f766e;border-right-color:#14b8a6;animation:schatLoaderSpin .72s linear infinite;box-shadow:0 10px 28px rgba(15,118,110,.16);background:transparent;}',
      'html.dark .schat-loader-spinner{border-color:rgba(255,255,255,.16);border-top-color:#5eead4;border-right-color:#99f6e4;}',
      '@keyframes schatLoaderSpin{to{transform:rotate(360deg)}}'
    ].join('');
    doc.head.appendChild(style);
  }

  function ensureUi() {
    if (!doc.body) return false;
    if (!state.overlay) {
      state.overlay = doc.createElement('div');
      state.overlay.id = 'schatGlobalLoader';
      state.overlay.setAttribute('aria-hidden', 'true');
      state.overlay.innerHTML = '<div class="schat-loader-spinner"></div>';
      doc.body.appendChild(state.overlay);
    }
    return true;
  }

  function showOverlay() {
    clearTimeout(state.hideTimer);
    clearTimeout(state.showTimer);
    if (!ensureUi() || !state.overlay) return;
    if (!state.visible) {
      state.visible = true;
      state.minVisibleUntil = Date.now() + 220;
      state.overlay.classList.add('visible');
    }
  }

  function scheduleOverlayReveal(delay) {
    if (state.visible || state.showTimer) return;
    state.showTimer = window.setTimeout(function () {
      state.showTimer = null;
      if (state.manualBlocks > 0 || state.pending > 0 || (state.booting && doc.readyState !== 'complete')) {
        showOverlay();
      }
    }, Math.max(0, Number(delay || 0)));
  }

  function hideOverlayIfAllowed() {
    clearTimeout(state.showTimer);
    state.showTimer = null;
    if (state.booting || state.manualBlocks > 0 || state.pending > 0) return;
    if (!state.overlay || !state.visible) return;
    var wait = Math.max(0, Number(state.minVisibleUntil || 0) - Date.now());
    clearTimeout(state.hideTimer);
    if (wait > 0) {
      state.hideTimer = window.setTimeout(hideOverlayIfAllowed, wait + 10);
      return;
    }
    state.visible = false;
    state.overlay.classList.remove('visible');
  }

  function settleBoot() {
    clearTimeout(state.settleTimer);
    state.settleTimer = window.setTimeout(function () {
      if (state.pending > 0) return;
      if (doc.readyState !== 'complete') return;
      state.booting = false;
      hideOverlayIfAllowed();
    }, 120);
  }

  function finishTrackedRequest() {
    state.pending = Math.max(0, Number(state.pending || 0) - 1);
    if (state.pending === 0) settleBoot();
    hideOverlayIfAllowed();
  }

  function shouldTrack(url) {
    var raw = String(url || '');
    if (!raw) return true;
    return raw.indexOf('/socket.io/') === -1;
  }

  function beginTrackedRequest(url) {
    if (!shouldTrack(url)) return function () {};
    state.pending += 1;
    scheduleOverlayReveal(state.booting ? 150 : 180);
    return finishTrackedRequest;
  }

  function safeSessionGet(key) {
    try {
      var raw = window.sessionStorage.getItem(CACHE_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function safeSessionSet(key, value) {
    try {
      window.sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
    } catch (_) {}
  }

  function safeSessionRemove(key) {
    try {
      window.sessionStorage.removeItem(CACHE_PREFIX + key);
    } catch (_) {}
  }

  function pruneExpiredCache() {
    try {
      for (var i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
        var key = window.sessionStorage.key(i);
        if (!key || key.indexOf(CACHE_PREFIX) !== 0) continue;
        var cached = safeSessionGet(key.slice(CACHE_PREFIX.length));
        if (!cached || Number(cached.expiresAt || 0) <= Date.now()) {
          window.sessionStorage.removeItem(key);
        }
      }
    } catch (_) {}
  }

  function readHeaderValue(headers, name) {
    if (!headers || !name) return '';
    var target = String(name).toLowerCase();
    if (typeof headers.get === 'function') {
      return String(headers.get(target) || headers.get(name) || '');
    }
    if (Array.isArray(headers)) {
      for (var i = 0; i < headers.length; i += 1) {
        var pair = headers[i];
        if (Array.isArray(pair) && String(pair[0] || '').toLowerCase() === target) {
          return String(pair[1] || '');
        }
      }
      return '';
    }
    var keys = Object.keys(headers);
    for (var j = 0; j < keys.length; j += 1) {
      if (String(keys[j] || '').toLowerCase() === target) {
        return String(headers[keys[j]] || '');
      }
    }
    return '';
  }

  function getRequestMethod(input, init) {
    return String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
  }

  function getNormalizedUrl(input) {
    try {
      var raw = typeof input === 'string' ? input : (input && input.url) || '';
      if (!raw) return null;
      var url = new URL(raw, window.location.href);
      if (url.origin !== window.location.origin) return null;
      return url;
    } catch (_) {
      return null;
    }
  }

  function getAuthSignature(input, init) {
    var auth = readHeaderValue(init && init.headers, 'authorization') || readHeaderValue(input && input.headers, 'authorization');
    if (!auth) {
      try {
        var token = window.localStorage.getItem('token') || '';
        auth = token ? 'Bearer ' + token : '';
      } catch (_) {
        auth = '';
      }
    }
    return auth ? String(auth).slice(-24) : 'anon';
  }

  function getCacheRule(pathname) {
    var target = String(pathname || '');
    for (var i = 0; i < CACHE_RULES.length; i += 1) {
      if (CACHE_RULES[i].re.test(target)) return CACHE_RULES[i];
    }
    return null;
  }

  function resolveResponseTtl(response, fallbackTtl) {
    var ttl = Math.max(0, Number(fallbackTtl || 0));
    var cacheControl = String(response && response.headers ? response.headers.get('cache-control') || '' : '');
    if (/no-store/i.test(cacheControl)) return 0;
    var maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
    if (maxAgeMatch) {
      var serverTtl = Math.max(0, Number(maxAgeMatch[1] || 0) * 1000);
      if (serverTtl > 0) ttl = ttl > 0 ? Math.min(ttl, serverTtl) : serverTtl;
    }
    return ttl;
  }

  function getRequestCacheMeta(input, init) {
    if (getRequestMethod(input, init) !== 'GET') return null;
    if (init && init.body != null) return null;
    if (init && init.signal) return null;
    if (String((init && init.cache) || '').toLowerCase() === 'no-store') return null;
    var url = getNormalizedUrl(input);
    if (!url) return null;
    var rule = getCacheRule(url.pathname);
    if (!rule) return null;
    return {
      key: url.pathname + url.search + '|' + getAuthSignature(input, init),
      ttl: Number(rule.ttl || 0),
      url: url.href
    };
  }

  function readFreshCacheEntry(key) {
    var cached = safeSessionGet(key);
    if (!cached) return null;
    if (Number(cached.expiresAt || 0) <= Date.now()) {
      safeSessionRemove(key);
      return null;
    }
    return cached;
  }

  function createResponseFromEntry(entry) {
    return new Response(entry && entry.bodyText != null ? entry.bodyText : '', {
      status: entry && entry.status ? entry.status : 200,
      statusText: entry && entry.statusText ? entry.statusText : '',
      headers: entry && Array.isArray(entry.headers) ? entry.headers : []
    });
  }

  function captureResponseEntry(response, fallbackTtl) {
    var ttl = resolveResponseTtl(response, fallbackTtl);
    return response.text().then(function (bodyText) {
      return {
        status: response.status,
        statusText: response.statusText,
        headers: Array.from(response.headers.entries()),
        bodyText: bodyText,
        expiresAt: Date.now() + ttl,
        cacheable: response.ok && ttl > 0
      };
    });
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

      var cacheMeta = getRequestCacheMeta(input, init);
      if (cacheMeta) {
        var cached = readFreshCacheEntry(cacheMeta.key);
        if (cached) {
          return Promise.resolve(createResponseFromEntry(cached));
        }

        var inflight = state.requestCache.get(cacheMeta.key);
        if (inflight) {
          return inflight.then(createResponseFromEntry);
        }

        var doneCached = beginTrackedRequest(cacheMeta.url || url);
        var requestPromise = originalFetch(input, init).then(function (response) {
          return captureResponseEntry(response, cacheMeta.ttl).then(function (entry) {
            if (entry.cacheable) safeSessionSet(cacheMeta.key, entry);
            return entry;
          });
        }, function (error) {
          throw error;
        }).finally(function () {
          state.requestCache.delete(cacheMeta.key);
          doneCached();
        });

        state.requestCache.set(cacheMeta.key, requestPromise);
        return requestPromise.then(createResponseFromEntry);
      }

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
      show: function () {
        state.manualBlocks += 1;
        showOverlay();
      },
      hide: function () {
        state.manualBlocks = Math.max(0, Number(state.manualBlocks || 0) - 1);
        hideOverlayIfAllowed();
      },
      setText: function () {}
    };
  }

  injectStyle();
  pruneExpiredCache();
  patchFetch();
  patchXhr();
  exposeApi();

  var bodyTimer = setInterval(function () {
    if (!doc.body) return;
    clearInterval(bodyTimer);
    ensureUi();
    scheduleOverlayReveal(180);
  }, 20);

  window.addEventListener('load', settleBoot, { passive: true });
  state.maxBootTimer = setTimeout(function () {
    state.booting = false;
    hideOverlayIfAllowed();
  }, 8000);
})();
