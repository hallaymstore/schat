(function () {
  if (window.__uniQuickMenuInit) return;
  window.__uniQuickMenuInit = true;

  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function qs(sel) {
    return document.querySelector(sel);
  }

  function qsa(sel) {
    return Array.from(document.querySelectorAll(sel));
  }

  function isVisible(el) {
    if (!el) return false;
    const st = window.getComputedStyle(el);
    return st.display !== "none" && st.visibility !== "hidden" && st.opacity !== "0";
  }

  function normalize(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function clickEl(el) {
    if (!el) return;
    try {
      el.click();
    } catch (_) {
      try {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      } catch (_) {}
    }
  }

  function findTrigger(def) {
    for (const fnName of def.functions || []) {
      if (typeof window[fnName] === "function") {
        return { type: "fn", fn: window[fnName] };
      }
    }
    for (const selector of def.selectors || []) {
      const el = qs(selector);
      if (isVisible(el)) return { type: "el", el };
    }
    const btnByText = qsa("button, a, [role='button']").find((el) => {
      if (!isVisible(el)) return false;
      const txt = normalize(el.textContent || el.innerText);
      return def.textMatchers.some((m) => m.test(txt));
    });
    if (btnByText) return { type: "el", el: btnByText };
    return null;
  }

  function safeNav(url) {
    try {
      window.location.href = url;
    } catch (_) {}
  }

  function detectDeviceProfile() {
    let liteSaved = "";
    try {
      liteSaved = String(localStorage.getItem("schat:lite-mode") || "");
    } catch (_) {}

    const nav = navigator || {};
    const ua = String(nav.userAgent || "").toLowerCase();
    const mem = Number(nav.deviceMemory || 0);
    const cores = Number(nav.hardwareConcurrency || 0);
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection || {};
    const effectiveType = String(conn.effectiveType || "").toLowerCase();
    const saveData = !!conn.saveData;
    const reducedMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const isMobile = !!(window.matchMedia && window.matchMedia("(max-width: 900px)").matches);
    const isAndroid = /android/i.test(ua);
    const androidMatch = ua.match(/android\s([0-9\.]+)/i);
    const androidVersion = androidMatch ? parseFloat(androidMatch[1] || "0") : 0;
    const legacyAndroid = isAndroid && !!androidVersion && androidVersion < 8;
    const hasWebRtc = !!(window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection);

    const lowMemory = mem > 0 && mem <= 2;
    const lowCpu = cores > 0 && cores <= 4;
    const slowNet = saveData || effectiveType === "slow-2g" || effectiveType === "2g" || effectiveType === "3g";
    const autoLowEnd = lowMemory || lowCpu || slowNet || reducedMotion || legacyAndroid;

    const forceOn = liteSaved === "1";
    const forceOff = liteSaved === "0";
    const lowEnd = forceOn ? true : (forceOff ? false : autoLowEnd);

    return {
      lowEnd: !!lowEnd,
      forceOn: !!forceOn,
      forceOff: !!forceOff,
      lowMemory: !!lowMemory,
      lowCpu: !!lowCpu,
      slowNet: !!slowNet,
      effectiveType: effectiveType,
      saveData: !!saveData,
      reducedMotion: !!reducedMotion,
      isMobile: !!isMobile,
      isAndroid: !!isAndroid,
      legacyAndroid: !!legacyAndroid,
      androidVersion: androidVersion || 0,
      hasWebRtc: !!hasWebRtc
    };
  }

  function applyDeviceProfile(profile) {
    const p = profile || { lowEnd: false, hasWebRtc: true };
    window.SChatDeviceProfile = p;
    window.__SCHAT_LITE_MODE = !!p.lowEnd;

    const root = document.documentElement;
    if (root) {
      root.classList.toggle("schat-low-end", !!p.lowEnd);
      root.classList.toggle("schat-legacy-android", !!p.legacyAndroid);
      root.classList.toggle("schat-no-webrtc", !p.hasWebRtc);
    }
    if (document.body) {
      document.body.classList.toggle("schat-low-end", !!p.lowEnd);
      document.body.classList.toggle("schat-legacy-android", !!p.legacyAndroid);
      document.body.classList.toggle("schat-no-webrtc", !p.hasWebRtc);
    }

    if (!document.getElementById("schatLitePerfStyle")) {
      const style = document.createElement("style");
      style.id = "schatLitePerfStyle";
      style.textContent = [
        "html.schat-low-end, html.schat-low-end body{scroll-behavior:auto !important;}",
        "html.schat-low-end body{background-attachment:scroll !important;}",
        "html.schat-low-end *{animation:none !important;transition:none !important;}",
        "html.schat-low-end *::before,html.schat-low-end *::after{animation:none !important;transition:none !important;}",
        "html.schat-low-end .hallaym-surface,html.schat-low-end .uni-glass-panel,",
        "html.schat-low-end .uni-quick-menu-panel,html.schat-low-end .uni-quick-menu-btn,",
        "html.schat-low-end [class*='glass'],html.schat-low-end [class*='blur']{",
        "backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}",
        "html.schat-low-end video{transform:translateZ(0);}",
        "html.schat-low-end #schatGlobalUpload .box{backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}"
      ].join("");
      document.head.appendChild(style);
    }

    try {
      window.dispatchEvent(new CustomEvent("schat:device-profile", { detail: p }));
    } catch (_) {
      try {
        const ev = document.createEvent("CustomEvent");
        ev.initCustomEvent("schat:device-profile", false, false, p);
        window.dispatchEvent(ev);
      } catch (_) {}
    }
  }

  function buildActionItems() {
    const defs = [
      {
        key: "create-group",
        label: "Guruh yaratish",
        icon: "fa-solid fa-users",
        functions: ["openCreateGroupModal", "showCreateGroupModal", "openGroupCreateModal"],
        selectors: ["#createGroupBtn", "#newGroupBtn", "#addGroupBtn", "[data-action='create-group']"],
        textMatchers: [/guruh yarat/i, /create group/i, /new group/i]
      },
      {
        key: "create-channel",
        label: "Kanal yaratish",
        icon: "fa-solid fa-bullhorn",
        functions: ["openCreateChannelModal", "showCreateChannelModal"],
        selectors: ["#createChannelBtn", "#newChannelBtn", "#addChannelBtn", "[data-action='create-channel']"],
        textMatchers: [/kanal yarat/i, /create channel/i, /new channel/i]
      },
      {
        key: "start-live",
        label: "Live boshlash",
        icon: "fa-solid fa-tower-broadcast",
        functions: ["openLiveModal", "startLiveNow", "openCreateLiveModal"],
        selectors: ["#startLiveBtn", "#createLiveBtn", "[data-action='start-live']"],
        textMatchers: [/live/i, /efir/i, /broadcast/i]
      },
      {
        key: "join-group",
        label: "Guruhga qo'shilish",
        icon: "fa-solid fa-right-to-bracket",
        functions: ["openJoinGroupModal", "showJoinModal"],
        selectors: ["#joinGroupBtn", "#joinBtn", "[data-action='join-group']"],
        textMatchers: [/qo'?shil/i, /join group/i]
      }
    ];

    const actions = [];
    defs.forEach((def) => {
      const trg = findTrigger(def);
      if (!trg) return;
      actions.push({
        key: def.key,
        label: def.label,
        icon: def.icon,
        run: function () {
          if (trg.type === "fn") return trg.fn();
          return clickEl(trg.el);
        }
      });
    });

    const path = (window.location.pathname || "").toLowerCase();
    const links = [
      { key: "home", label: "Bosh sahifa", icon: "fa-solid fa-house", url: "/index.html" },
      { key: "groups", label: "Guruhlar", icon: "fa-solid fa-users", url: "/groups.html" },
      { key: "channels", label: "Kanallar", icon: "fa-solid fa-bullhorn", url: "/channels.html" },
      { key: "lives", label: "Live", icon: "fa-solid fa-tower-broadcast", url: "/lives.html" },
      { key: "profile", label: "Profil", icon: "fa-solid fa-user", url: "/profile.html" }
    ];
    links.forEach((lnk) => {
      if (path.endsWith(lnk.url.toLowerCase())) return;
      actions.push({
        key: "goto-" + lnk.key,
        label: lnk.label,
        icon: lnk.icon,
        run: function () {
          safeNav(lnk.url);
        }
      });
    });

    const liteOn = !!window.__SCHAT_LITE_MODE;
    actions.push({
      key: "lite-mode",
      label: liteOn ? "Lite rejimni o'chirish" : "Lite rejimni yoqish",
      icon: "fa-solid fa-gauge-simple-high",
      run: function () {
        try {
          localStorage.setItem("schat:lite-mode", liteOn ? "0" : "1");
        } catch (_) {}
        window.location.reload();
      }
    });

    return actions;
  }

  function stylePanels() {
    const selectors = [
      "main > section",
      "main > div",
      ".container > section",
      ".container > div",
      ".modal-content",
      ".card",
      ".panel",
      ".widget"
    ];
    qsa(selectors.join(",")).forEach((el) => {
      if (!isVisible(el)) return;
      if (el.classList.contains("uni-quick-menu-panel")) return;
      if (el.classList.contains("uni-glass-panel")) return;
      el.classList.add("uni-glass-panel");
    });
  }

  function createMenu() {
    if (qs("#uniQuickMenuBtn")) return;

    const actions = buildActionItems();
    if (!actions.length) return;

    const panel = document.createElement("div");
    panel.id = "uniQuickMenuPanel";
    panel.className = "uni-quick-menu-panel";
    panel.style.display = "none";

    const title = document.createElement("div");
    title.className = "uni-quick-menu-title";
    title.textContent = "Tezkor amallar";
    panel.appendChild(title);

    actions.forEach((a) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "uni-quick-menu-item";
      item.innerHTML = '<i class="' + a.icon + '"></i><span>' + a.label + "</span>";
      item.addEventListener("click", function () {
        panel.style.display = "none";
        a.run();
      });
      panel.appendChild(item);
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "uni-quick-menu-item";
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i><span>Yopish</span>';
    closeBtn.addEventListener("click", function () {
      panel.style.display = "none";
    });
    panel.appendChild(closeBtn);

    const btn = document.createElement("button");
    btn.id = "uniQuickMenuBtn";
    btn.type = "button";
    btn.className = "uni-quick-menu-btn";
    btn.innerHTML = '<i class="fa-solid fa-bars"></i> Menu';
    btn.addEventListener("click", function () {
      panel.style.display = panel.style.display === "none" ? "block" : "none";
    });

    document.body.appendChild(panel);
    document.body.appendChild(btn);

    document.addEventListener("click", function (e) {
      const t = e.target;
      if (!panel.contains(t) && !btn.contains(t)) {
        panel.style.display = "none";
      }
    });
  }

  function safeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, function (m) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m];
    });
  }

  function ensureSocketIoLoaded() {
    if (typeof window.io === "function") return Promise.resolve(true);
    return new Promise(function (resolve) {
      const existing = document.querySelector("script[data-schat-socketio='1']");
      if (existing) {
        existing.addEventListener("load", function () { resolve(typeof window.io === "function"); }, { once: true });
        existing.addEventListener("error", function () { resolve(false); }, { once: true });
        return;
      }
      const s = document.createElement("script");
      s.src = "/socket.io/socket.io.js";
      s.defer = true;
      s.setAttribute("data-schat-socketio", "1");
      s.onload = function () { resolve(typeof window.io === "function"); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
  }

  function initGlobalUploadHud() {
    if (window.__SCHAT_GLOBAL_UPLOAD_HUD__) return;
    window.__SCHAT_GLOBAL_UPLOAD_HUD__ = true;

    if (!document.getElementById("schatGlobalUploadStyle")) {
      const style = document.createElement("style");
      style.id = "schatGlobalUploadStyle";
      style.textContent = [
        "#schatGlobalUpload{position:fixed;right:14px;top:14px;z-index:2147483600;display:none;}",
        "#schatGlobalUpload .box{min-width:260px;max-width:min(88vw,360px);padding:12px;border-radius:14px;",
        "background:linear-gradient(135deg,rgba(13,44,52,.86),rgba(8,33,39,.88));",
        "border:1px solid rgba(255,255,255,.16);box-shadow:0 18px 46px rgba(0,0,0,.42);",
        "backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial}",
        "#schatGlobalUpload .title{font-weight:800;font-size:13px;line-height:1.2}",
        "#schatGlobalUpload .sub{font-size:11px;opacity:.78;margin-top:3px}",
        "#schatGlobalUpload .bar{height:8px;background:rgba(255,255,255,.14);border-radius:999px;overflow:hidden;margin-top:9px}",
        "#schatGlobalUpload .fill{height:100%;width:0%;background:linear-gradient(90deg,#2dd4bf,#f59e0b)}",
        "#schatGlobalUpload .pct{font-size:11px;font-weight:800;opacity:.92;margin-top:6px;text-align:right}",
        "@media (max-width:640px){#schatGlobalUpload{right:10px;top:10px}#schatGlobalUpload .box{min-width:220px;max-width:86vw}}"
      ].join("");
      document.head.appendChild(style);
    }

    let host = document.getElementById("schatGlobalUpload");
    if (!host) {
      host = document.createElement("div");
      host.id = "schatGlobalUpload";
      host.innerHTML = [
        '<div class="box">',
        '<div class="title" id="schatGlobalUploadTitle">Video yuklanmoqda...</div>',
        '<div class="sub" id="schatGlobalUploadSub">Yuklash fon rejimida davom etadi.</div>',
        '<div class="bar"><div class="fill" id="schatGlobalUploadFill"></div></div>',
        '<div class="pct" id="schatGlobalUploadPct">0%</div>',
        "</div>"
      ].join("");
      document.body.appendChild(host);
    }

    function setText(title, sub) {
      const t = document.getElementById("schatGlobalUploadTitle");
      const s = document.getElementById("schatGlobalUploadSub");
      if (t && title) t.textContent = title;
      if (s && sub) s.textContent = sub;
    }
    function setPct(percent) {
      const p = Math.max(0, Math.min(100, Number(percent || 0)));
      const fill = document.getElementById("schatGlobalUploadFill");
      const pct = document.getElementById("schatGlobalUploadPct");
      if (fill) fill.style.width = p + "%";
      if (pct) pct.textContent = p + "%";
    }
    function show() { host.style.display = "block"; }
    function hide() { host.style.display = "none"; }

    window.SChatGlobalUX = Object.assign({}, window.SChatGlobalUX || {}, {
      showUploadStart: function (title, sub) {
        setText(title || "Video yuklanmoqda...", sub || "Yuklash fon rejimida davom etadi.");
        setPct(0);
        show();
      },
      showUploadProgress: function (percent, sub) {
        setPct(percent);
        if (sub) setText("", sub);
        show();
      },
      showUploadDone: function (text) {
        setText(text || "Video saqlandi", "Yuklash yakunlandi.");
        setPct(100);
        show();
        setTimeout(hide, 1500);
      },
      showUploadError: function (text) {
        setText(text || "Yuklashda xatolik", "Internet tiklanganda avtomatik urinish bo‘ladi.");
        show();
        setTimeout(hide, 2600);
      },
      hideUpload: hide
    });

    window.addEventListener("schat:lesson-upload", function (ev) {
      const d = ev && ev.detail ? ev.detail : {};
      const state = String(d.state || "").toLowerCase();
      const ux = window.SChatGlobalUX || {};
      if (state === "start" && typeof ux.showUploadStart === "function") return ux.showUploadStart(d.title, d.text);
      if (state === "progress" && typeof ux.showUploadProgress === "function") return ux.showUploadProgress(d.percent, d.text);
      if (state === "done" && typeof ux.showUploadDone === "function") return ux.showUploadDone(d.text);
      if (state === "error" && typeof ux.showUploadError === "function") return ux.showUploadError(d.text);
      if (state === "hide" && typeof ux.hideUpload === "function") return ux.hideUpload();
    });
  }

  function initGlobalLessonUploadWorker() {
    if (window.__SCHAT_GLOBAL_RECORDING_WORKER__) return;
    window.__SCHAT_GLOBAL_RECORDING_WORKER__ = true;

    const token = localStorage.getItem("token");
    if (!token) return;

    const path = String(window.location.pathname || "").toLowerCase();
    // group pages have their own in-page uploader and progress overlay
    if (/\/group(?!s)[^/]*\.html$/.test(path)) return;

    const DB_NAME = "schat_recordings";
    const STORE = "queue";
    let running = false;

    function openDb() {
      return new Promise(function (resolve, reject) {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    }

    async function listQueue() {
      const db = await openDb();
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    }

    async function deleteQueueItem(id) {
      const db = await openDb();
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    }

    function uploadQueueItem(item, authToken, onProgress) {
      return new Promise(function (resolve, reject) {
        try {
          if (!item || !item.lessonId || !item.blob) return reject(new Error("Invalid queue item"));
          const fd = new FormData();
          const filename = item.filename || ("lesson_" + item.lessonId + ".webm");
          fd.append("recording", item.blob, filename);
          if (item.title) fd.append("title", item.title);

          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/group-lessons/" + encodeURIComponent(String(item.lessonId)) + "/recording", true);
          xhr.setRequestHeader("Authorization", "Bearer " + authToken);
          xhr.timeout = 20 * 60 * 1000;
          xhr.upload.onprogress = function (e) {
            if (!e || !e.lengthComputable) return;
            const percent = Math.max(0, Math.min(100, Math.round((e.loaded / e.total) * 100)));
            if (typeof onProgress === "function") onProgress(percent);
          };
          xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) return resolve(true);
            return reject(new Error("Upload HTTP " + xhr.status));
          };
          xhr.onerror = function () { reject(new Error("Upload network error")); };
          xhr.ontimeout = function () { reject(new Error("Upload timeout")); };
          xhr.send(fd);
        } catch (e) {
          reject(e);
        }
      });
    }

    async function processQueue() {
      if (running) return;
      if (!navigator.onLine) return;
      running = true;
      try {
        const items = (await listQueue())
          .filter(function (it) { return !!(it && it.lessonId && it.blob); })
          .sort(function (a, b) { return Number(a.ts || 0) - Number(b.ts || 0); });

        if (!items.length) return;

        const ux = window.SChatGlobalUX || {};
        for (const it of items) {
          const authToken = localStorage.getItem("token") || it.token || "";
          if (!authToken) break;

          if (typeof ux.showUploadStart === "function") {
            ux.showUploadStart("Video yuklanmoqda...", "Sahifa almashsa ham davom etadi.");
          }

          try {
            await uploadQueueItem(it, authToken, function (percent) {
              const uxx = window.SChatGlobalUX || {};
              if (typeof uxx.showUploadProgress === "function") {
                uxx.showUploadProgress(percent, "Dars yozuvi yuborilmoqda...");
              }
            });
            await deleteQueueItem(it.id);
            const uxd = window.SChatGlobalUX || {};
            if (typeof uxd.showUploadDone === "function") {
              uxd.showUploadDone("Dars yozuvi saqlandi");
            }
          } catch (e) {
            const uxe = window.SChatGlobalUX || {};
            if (typeof uxe.showUploadError === "function") {
              uxe.showUploadError("Yozuv yuklanmadi, internet tiklanganda davom etadi");
            }
            break;
          }
        }
      } catch (_) {
      } finally {
        running = false;
      }
    }

    window.SChatGlobalUX = Object.assign({}, window.SChatGlobalUX || {}, {
      processPendingUploads: processQueue
    });

    window.addEventListener("online", processQueue);
    window.addEventListener("focus", processQueue);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) processQueue();
    });
    setTimeout(processQueue, 250);
    setInterval(processQueue, 15000);
  }

  function shouldSkipGlobalCallPopup() {
    const path = String(window.location.pathname || "").toLowerCase();
    if (/\/chat[^/]*\.html$/.test(path)) return true;   // chat pages have built-in call modal
    if (/\/group(?!s)[^/]*\.html$/.test(path)) return true;  // group call pages have built-in modal
    return false;
  }

  function initGlobalIncomingCallModal() {
    if (window.__SCHAT_GLOBAL_CALL_MODAL__) return;
    if (window.__SCHAT_CALLKIT__) return; // messages page legacy callkit
    if (shouldSkipGlobalCallPopup()) return;

    const token = localStorage.getItem("token");
    if (!token) return;

    ensureSocketIoLoaded().then(function (ok) {
      if (!ok || typeof window.io !== "function") return;
      if (window.__SCHAT_GLOBAL_CALL_MODAL__) return;
      window.__SCHAT_GLOBAL_CALL_MODAL__ = true;

      const socket = window.io({
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: 8,
        reconnectionDelay: 1000
      });
      window.__SCHAT_GLOBAL_CALL_SOCKET__ = socket;

      if (!document.getElementById("schatIncomingStyle")) {
        const style = document.createElement("style");
        style.id = "schatIncomingStyle";
        style.textContent = [
          "#schatIncomingHost{position:fixed;right:14px;bottom:14px;z-index:2147483600;display:none;}",
          "#schatIncomingHost .card{width:min(92vw,360px);border-radius:16px;padding:14px;",
          "background:radial-gradient(120% 140% at 100% 0%,rgba(34,211,238,.18),transparent 55%),linear-gradient(135deg,rgba(9,28,34,.92),rgba(8,20,28,.92));",
          "border:1px solid rgba(255,255,255,.16);box-shadow:0 24px 60px rgba(0,0,0,.48);color:#fff;",
          "backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial}",
          "#schatIncomingHost .top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}",
          "#schatIncomingHost .type{font-size:11px;font-weight:800;opacity:.9;letter-spacing:.3px;text-transform:uppercase}",
          "#schatIncomingHost .title{font-size:14px;font-weight:800;line-height:1.25;margin-top:2px}",
          "#schatIncomingHost .meta{font-size:12px;opacity:.82;margin-top:4px;line-height:1.25}",
          "#schatIncomingHost .online{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(74,222,128,.45);",
          "background:rgba(16,185,129,.14);padding:4px 8px;border-radius:999px;font-size:11px;font-weight:800}",
          "#schatIncomingHost .dot{width:7px;height:7px;border-radius:999px;background:#34d399;box-shadow:0 0 0 4px rgba(16,185,129,.18)}",
          "#schatIncomingHost .actions{display:flex;gap:8px;margin-top:12px}",
          "#schatIncomingHost .btn{flex:1;border:1px solid rgba(255,255,255,.2);border-radius:12px;padding:9px 10px;font-size:12px;font-weight:800;color:#fff;cursor:pointer}",
          "#schatIncomingHost .btnOk{background:linear-gradient(135deg,rgba(34,197,94,.94),rgba(16,185,129,.94));}",
          "#schatIncomingHost .btnNo{background:rgba(255,255,255,.08)}",
          "#schatIncomingHost .x{border:none;background:transparent;color:#fff;opacity:.72;font-size:16px;cursor:pointer;padding:2px 4px}",
          "@media (max-width:640px){#schatIncomingHost{left:10px;right:10px;bottom:10px}#schatIncomingHost .card{width:auto}}"
        ].join("");
        document.head.appendChild(style);
      }

      let host = document.getElementById("schatIncomingHost");
      if (!host) {
        host = document.createElement("div");
        host.id = "schatIncomingHost";
        document.body.appendChild(host);
      }

      let activeKey = "";
      let hideTimer = null;
      const seen = new Set();

      function hideCard() {
        host.style.display = "none";
        host.innerHTML = "";
        activeKey = "";
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = null;
        }
      }

      function showCard(data) {
        const key = String(data.key || "");
        if (!key) return;
        if (key === activeKey) return;
        if (seen.has(key)) return;
        seen.add(key);
        if (seen.size > 120) seen.clear();
        activeKey = key;

        host.innerHTML = [
          '<div class="card">',
          '<div class="top">',
          "<div>",
          '<div class="type">' + safeHtml(data.badge || "Incoming call") + "</div>",
          '<div class="title">' + safeHtml(data.title || "Qo‘ng‘iroq") + "</div>",
          '<div class="meta">' + safeHtml(data.meta || "") + "</div>",
          "</div>",
          '<button class="x" type="button" data-act="dismiss">✕</button>',
          "</div>",
          '<div class="online"><span class="dot"></span><span>' + safeHtml(data.statusText || "Online") + "</span></div>",
          '<div class="actions">',
          '<button class="btn btnOk" type="button" data-act="accept">' + safeHtml(data.acceptLabel || "Qabul qilish") + "</button>",
          '<button class="btn btnNo" type="button" data-act="reject">' + safeHtml(data.rejectLabel || "Keyinroq") + "</button>",
          "</div>",
          "</div>"
        ].join("");
        host.style.display = "block";

        const dismiss = host.querySelector("[data-act='dismiss']");
        const reject = host.querySelector("[data-act='reject']");
        const accept = host.querySelector("[data-act='accept']");
        if (dismiss) dismiss.addEventListener("click", hideCard);
        if (reject) reject.addEventListener("click", function () {
          if (typeof data.onReject === "function") data.onReject();
          hideCard();
        });
        if (accept) accept.addEventListener("click", function () {
          if (typeof data.onAccept === "function") data.onAccept();
          hideCard();
        });

        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(hideCard, Number(data.timeoutMs || 45000));
      }

      socket.on("connect", function () {
        socket.emit("authenticate", token);
      });

      socket.on("callOffer", function (data) {
        const from = String(data?.from || "");
        if (!from) return;
        const caller = data?.callerInfo || {};
        const callId = String(caller.callId || data?.callId || "");
        const kind = String(data?.type || "audio").toLowerCase() === "video" ? "video" : "audio";
        const name = String(caller.nickname || caller.fullName || data?.fromName || "Noma’lum");
        const key = callId ? ("priv:" + callId) : ("priv:" + from + ":" + Date.now());

        showCard({
          key: key,
          badge: "1V1 qo‘ng‘iroq",
          title: name + (kind === "video" ? " (Video)" : " (Audio)"),
          meta: "Sizni chat orqali qo‘ng‘iroqqa taklif qildi.",
          statusText: "Online",
          acceptLabel: "Qabul qilish",
          rejectLabel: "Rad etish",
          onAccept: function () {
            try {
              localStorage.setItem("schat:pendingIncomingCall", JSON.stringify({
                from: from,
                type: kind,
                offer: data?.offer || null,
                callId: callId || null,
                callerInfo: caller || null,
                ts: Date.now()
              }));
            } catch (_) {}
            safeNav("/chat.html?user=" + encodeURIComponent(from) + "&autocall=1");
          },
          onReject: function () {
            socket.emit("callRejected", { to: from, callId: callId || null });
          }
        });
      });

      socket.on("groupCallIncomingGlobal", function (data) {
        const groupId = String(data?.groupId || "");
        const callId = String(data?.callId || "");
        if (!groupId || !callId) return;

        const callType = String(data?.callType || "video").toLowerCase() === "audio" ? "audio" : "video";
        const groupLabel = String(data?.groupName || data?.groupUsername || "Guruh");
        const fromName = String(data?.fromName || "O‘qituvchi");
        const title = String(data?.title || "Live dars");
        const key = "group:" + groupId + ":" + callId;

        showCard({
          key: key,
          badge: "Guruh qo‘ng‘irog‘i",
          title: groupLabel + " • " + (callType === "video" ? "Video" : "Audio"),
          meta: fromName + " live dars boshladi: " + title,
          statusText: "Hozir online",
          acceptLabel: "Qo‘shilish",
          rejectLabel: "Yopish",
          onAccept: function () {
            try {
              localStorage.setItem("schat:pendingGroupCall", JSON.stringify({
                groupId: groupId,
                callId: callId,
                callType: callType,
                title: title,
                ts: Date.now()
              }));
            } catch (_) {}
            safeNav("/group.html?id=" + encodeURIComponent(groupId) + "&autoJoin=1");
          }
        });
      });
    }).catch(function () {});
  }

  onReady(function () {
    applyDeviceProfile(detectDeviceProfile());
    document.documentElement.classList.add("uni-theme");
    if (document.body) document.body.classList.add("uni-theme-body");
    stylePanels();
    createMenu();
    initGlobalUploadHud();
    initGlobalLessonUploadWorker();
    initGlobalIncomingCallModal();
    setTimeout(stylePanels, 200);
  });
})();
