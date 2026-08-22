(function () {
  if (window.__schatUzLocalizeReady) return;
  window.__schatUzLocalizeReady = true;

  var TEXT_MAP = [
    ['Premium Payment Center', 'Premium to‘lov markazi'],
    ['Settings Center', 'Sozlamalar markazi'],
    ['Notification Center', 'Bildirishnoma markazi'],
    ['Direct messages', 'Shaxsiy xabarlar'],
    ['Course updates', 'Kurs yangiliklari'],
    ['Live classes', 'Jonli darslar'],
    ['AI products', 'AI mahsulotlari'],
    ['Billing', 'To‘lovlar'],
    ['Unread', 'O‘qilmagan'],
    ['Read', 'O‘qilgan'],
    ['Register/Login', 'Ro‘yxatdan o‘tish / Kirish'],
    ['Contact form', 'Aloqa formasi'],
    ['Waitlist', 'Kutish ro‘yxati'],
    ['No groups found', 'Guruhlar topilmadi'],
    ['Error Loading Groups', 'Guruhlarni yuklashda xatolik'],
    ['Loading university data...', 'Universitet ma’lumotlari yuklanmoqda...'],
    ['Loading live events...', 'Jonli voqealar yuklanmoqda...'],
    ['Loading...', 'Yuklanmoqda...'],
    ['Loading', 'Yuklanmoqda'],
    ['User premium active', 'User premium faol'],
    ['User premium off', 'User premium o‘chirilgan'],
    ['Campus plan active', 'Campus plan faol'],
    ['Campus plan off', 'Campus plan o‘chirilgan'],
    ['Unknown', 'Noma’lum'],
    ['Dashboard', 'Boshqaruv paneli'],
    ['Settings', 'Sozlamalar'],
    ['Notifications', 'Bildirishnomalar'],
    ['Quick Settings', 'Tezkor sozlamalar'],
    ['Animated stickers', 'Animatsiyali stikerlar'],
    ['Viewers', 'Tomoshabinlar'],
    ['LIVE now', 'Hozir jonli']
  ];

  var WORD_MAP = [
    ['toвЂlov', 'to‘lov'],
    ['ToвЂlov', 'To‘lov'],
    ['soвЂrov', 'so‘rov'],
    ['SoвЂrov', 'So‘rov'],
    ['oвЂq', 'o‘q'],
    ['OвЂq', 'O‘q'],
    ['qoвЂsh', 'qo‘sh'],
    ['QoвЂsh', 'Qo‘sh'],
    ['oвЂch', 'o‘ch'],
    ['OвЂch', 'O‘ch'],
    ['maвЂ', 'ma‘'],
    ['NomaвЂ™lum', 'Noma’lum'],
    ['вЂ”', '—'],
    ['вЂ', '‘'],
    ['вЂ™', '’'],
    ['РІР‚вЂќ', '—'],
    ['РІР‚В', '‘'],
    ['РІР‚в„ў', '’'],
    ['Р’В·', ' · '],
    ['To?lov', 'To‘lov'],
    ['to?lov', 'to‘lov'],
    ['so?rov', 'so‘rov'],
    ['So?rov', 'So‘rov'],
    ['Oqilgan', 'O‘qilgan'],
    ['oqilgan', 'o‘qilgan'],
    ['oqish', 'o‘qish'],
    ['qosh', 'qo‘sh'],
    ['Qosh', 'Qo‘sh'],
    ['ochir', 'o‘chir'],
    ['Ochir', 'O‘chir'],
    ['Royxat', 'Ro‘yxat'],
    ['royxat', 'ro‘yxat'],
    ['Boglan', 'Bog‘lan'],
    ['boglan', 'bog‘lan']
  ];

  function normalizeText(value) {
    var text = String(value || '');
    WORD_MAP.forEach(function (pair) {
      text = text.split(pair[0]).join(pair[1]);
    });
    TEXT_MAP.forEach(function (pair) {
      text = text.split(pair[0]).join(pair[1]);
    });
    return text;
  }

  function shouldSkip(node) {
    if (!node || !node.parentNode) return true;
    var parent = node.parentNode;
    var tag = String(parent.nodeName || '').toLowerCase();
    return tag === 'script' || tag === 'style' || tag === 'code' || tag === 'pre' || tag === 'textarea';
  }

  function patchTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE || shouldSkip(node)) return;
    var next = normalizeText(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  function patchAttributes(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var list = scope.querySelectorAll('[placeholder],[title],[aria-label],[alt]');
    list.forEach(function (el) {
      ['placeholder', 'title', 'aria-label', 'alt'].forEach(function (name) {
        if (!el.hasAttribute(name)) return;
        var value = el.getAttribute(name);
        var next = normalizeText(value);
        if (next !== value) el.setAttribute(name, next);
      });
    });
  }

  function patchTree(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      patchTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root !== document) return;
    var walker = document.createTreeWalker(root === document ? document.body || document.documentElement : root, NodeFilter.SHOW_TEXT);
    var node = walker.nextNode();
    while (node) {
      patchTextNode(node);
      node = walker.nextNode();
    }
    patchAttributes(root === document ? document : root);
  }

  function patchMeta() {
    document.title = normalizeText(document.title);
    document.querySelectorAll('meta[name="description"], meta[property="og:title"], meta[property="og:description"]').forEach(function (meta) {
      var content = meta.getAttribute('content') || '';
      var next = normalizeText(content);
      if (next !== content) meta.setAttribute('content', next);
    });
  }

  function schedulePatch(root) {
    window.requestAnimationFrame(function () {
      patchMeta();
      patchTree(root || document);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { schedulePatch(document); }, { once: true });
  } else {
    schedulePatch(document);
  }
  window.addEventListener('load', function () { schedulePatch(document); }, { once: true });

  var observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      if (mutation.type === 'characterData') {
        patchTextNode(mutation.target);
        return;
      }
      mutation.addedNodes.forEach(function (node) {
        schedulePatch(node);
      });
      if (mutation.type === 'attributes' && mutation.target) {
        patchAttributes(mutation.target);
      }
    });
  });

  var startObserve = function () {
    if (!document.documentElement) return;
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label', 'alt']
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserve, { once: true });
  } else {
    startObserve();
  }
})();
