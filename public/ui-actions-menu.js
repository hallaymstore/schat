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

  onReady(function () {
    document.documentElement.classList.add("uni-theme");
    if (document.body) document.body.classList.add("uni-theme-body");
    stylePanels();
    createMenu();
    setTimeout(stylePanels, 200);
  });
})();
