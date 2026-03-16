(function(){
  if (window.__schatAssistantReady) return;
  window.__schatAssistantReady = true;

  function byId(id){ return document.getElementById(id); }
  function esc(v){ return String(v||'').replace(/[&<>\"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'})[c]; }); }
  function token(){ return localStorage.getItem('token') || ''; }
  function hasToken(){ return !!token(); }

  function injectStyle(){
    if (byId('schat-assistant-style')) return;
    var css = `
#schatAssistantDock{position:fixed;right:18px;bottom:18px;z-index:2147483660;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
#schatAssistantDock *{box-sizing:border-box}
#schatAssistantBtn{width:58px;height:58px;border-radius:16px;border:1px solid rgba(255,255,255,.24);background:linear-gradient(135deg,#0ea5a7,#f59e0b);color:#fff;font-weight:900;display:flex;align-items:center;justify-content:center;cursor:grab;box-shadow:0 18px 40px rgba(0,0,0,.28);user-select:none;touch-action:none}
#schatAssistantBadge{position:absolute;top:-6px;right:-6px;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#ef4444;color:#fff;font-size:11px;font-weight:800;display:none;align-items:center;justify-content:center}
#schatAssistantPanel{position:absolute;right:0;bottom:70px;width:min(360px,92vw);max-height:min(72vh,640px);display:none;flex-direction:column;border-radius:16px;border:1px solid rgba(255,255,255,.24);background:rgba(2,6,23,.9);backdrop-filter:blur(12px);box-shadow:0 22px 60px rgba(0,0,0,.4);overflow:hidden}
#schatAssistantPanel.open{display:flex}
.schatAHead{padding:10px 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(148,163,184,.25);color:#e2e8f0}
.schatATabs{display:flex;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(148,163,184,.16)}
.schatATab{padding:6px 10px;border-radius:999px;font-size:12px;font-weight:800;border:1px solid rgba(148,163,184,.28);color:#cbd5e1;background:rgba(30,41,59,.55);cursor:pointer}
.schatATab.active{background:linear-gradient(135deg,#0ea5a7,#f59e0b);color:#fff;border-color:transparent}
.schatABody{padding:10px;overflow:auto;min-height:180px;max-height:42vh;background:rgba(2,6,23,.35)}
.schatMsg{margin-bottom:8px;padding:8px 10px;border-radius:12px;font-size:13px;line-height:1.35;color:#e2e8f0;border:1px solid rgba(148,163,184,.15);background:rgba(30,41,59,.55)}
.schatMsg.user{background:rgba(14,165,167,.22);border-color:rgba(20,184,166,.35)}
.schatMsg.admin{background:rgba(245,158,11,.18);border-color:rgba(245,158,11,.36)}
.schatMsg.note{background:rgba(99,102,241,.18);border-color:rgba(99,102,241,.35)}
.schatAQuick{padding:8px 10px;display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid rgba(148,163,184,.16)}
.schatQBtn{padding:5px 8px;border-radius:999px;font-size:11px;font-weight:800;color:#e2e8f0;background:rgba(30,41,59,.7);border:1px solid rgba(148,163,184,.24);cursor:pointer}
.schatAFoot{padding:8px;border-top:1px solid rgba(148,163,184,.2);display:grid;grid-template-columns:1fr auto auto;gap:6px;background:rgba(2,6,23,.7)}
#schatAText{padding:9px 10px;border-radius:10px;border:1px solid rgba(148,163,184,.24);background:rgba(30,41,59,.65);color:#e2e8f0;font-size:13px}
.schatABtn{padding:9px 10px;border-radius:10px;border:1px solid rgba(148,163,184,.24);background:rgba(30,41,59,.8);color:#e2e8f0;font-size:12px;font-weight:800;cursor:pointer}
.schatABtn.primary{background:linear-gradient(135deg,#0ea5a7,#f59e0b);border-color:transparent;color:#fff}
.schatHint{font-size:11px;color:#94a3b8;padding:0 10px 8px}
@media (max-width:640px){#schatAssistantPanel{bottom:72px;right:0;width:min(94vw,380px)}#schatAssistantDock{right:12px;bottom:12px}}
`;
    var st = document.createElement('style');
    st.id = 'schat-assistant-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function moveBottomMenuToTop(){
    var moved = 0;
    var keptOne = false;
    var all = Array.prototype.slice.call(document.querySelectorAll('body *'));
    all.forEach(function(el){
      try {
        var cs = window.getComputedStyle(el);
        if (cs.position !== 'fixed') return;
        var b = parseFloat(cs.bottom || '');
        var txt = (el.textContent || '').trim().toLowerCase();
        var isMenuLike = txt === 'menu' || txt.endsWith(' menu') || txt.indexOf('\nmenu') >= 0 || txt === 'hallyam menu';
        if (!isMenuLike) return;
        if (!(isFinite(b) && b >= 0 && b <= 40)) return;
        if (keptOne) {
          el.style.display = 'none';
          return;
        }
        el.style.top = '12px';
        el.style.bottom = 'auto';
        if (!el.style.right) el.style.right = '12px';
        el.style.zIndex = '2147482000';
        keptOne = true;
        moved++;
      } catch(_) {}
    });
    var mBottomNav = byId('mBottomNav');
    if (mBottomNav) {
      mBottomNav.style.top = '12px';
      mBottomNav.style.bottom = 'auto';
      mBottomNav.style.left = '12px';
      mBottomNav.style.right = '12px';
      mBottomNav.style.zIndex = '2147482000';
      mBottomNav.style.maxWidth = 'calc(100vw - 24px)';
      mBottomNav.style.overflowX = 'auto';
      mBottomNav.style.overflowY = 'hidden';
      mBottomNav.style.whiteSpace = 'nowrap';
      moved++;
    }
    if (moved > 0) {
      var root = document.documentElement;
      if (!root.classList.contains('schat-top-menu-adjusted')) {
        root.classList.add('schat-top-menu-adjusted');
        document.body.style.paddingTop = (parseInt(getComputedStyle(document.body).paddingTop || '0', 10) + 64) + 'px';
      }
    }
  }

  var kw = [
    {k:['call','video','kamera','camera','mic','mikrofon','ovoz'], a:'Call muammosi uchun: 1) internetni tekshiring, 2) browserga camera/mic ruxsat bering, 3) sahifani yangilang. Kerak bo\'lsa adminga yozing.'},
    {k:['coin','balans','balance','tolov','to\'lov','som','so\'m'], a:'Balans va coin masalalarida screenshot bilan adminga yozing. Admin javobi shu oynaga tushadi.'},
    {k:['kurs','course','test','sertifikat','certificate'], a:'Kurs/test/sertifikat bo\'yicha ma\'lumotni Profil > Kurslar/Testlar bo\'limidan tekshiring. Muammo qolsa adminga yuboring.'},
    {k:['group','guruh','join','qoshil','qo\'shil','channel','kanal'], a:'Guruh/Kanal topilmasa Search bo\'limidan qidiring yoki username bilan kirib ko\'ring. Kerak bo\'lsa adminga yuboring.'}
  ];

  function findKeywordAnswer(text){
    var t = String(text || '').toLowerCase();
    for (var i=0;i<kw.length;i++) {
      var hit = kw[i].k.some(function(x){ return t.indexOf(x) >= 0; });
      if (hit) return kw[i].a;
    }
    return 'Savol qabul qilindi. Tezkor javob topilmadi, adminga yuborsangiz operator javob beradi.';
  }

  function createDock(){
    if (byId('schatAssistantDock')) return byId('schatAssistantDock');
    var host = document.createElement('div');
    host.id = 'schatAssistantDock';
    host.innerHTML = [
      '<div id="schatAssistantPanel">',
      ' <div class="schatAHead"><div style="font-weight:900;font-size:13px">Yordamchi Chat</div><button id="schatAClose" class="schatABtn" style="padding:4px 8px">Yopish</button></div>',
      ' <div class="schatATabs">',
      '   <button class="schatATab active" data-tab="bot">Tezkor Bot</button>',
      '   <button class="schatATab" data-tab="lab">Lab AI</button>',
      '   <button class="schatATab" data-tab="support">Admin bilan</button>',
      '   <button class="schatATab" data-tab="notif">Xabarnoma</button>',
      ' </div>',
      ' <div id="schatABody" class="schatABody"></div>',
      ' <div id="schatAQuick" class="schatAQuick"></div>',
      ' <div class="schatHint" id="schatAHint">Kalit soz bo\'yicha tezkor javob olasiz.</div>',
      ' <div class="schatAFoot">',
      '   <input id="schatAText" placeholder="Savolingizni yozing..."/>',
      '   <button id="schatASend" class="schatABtn">Yuborish</button>',
      '   <button id="schatASendAdmin" class="schatABtn primary">Adminga</button>',
      ' </div>',
      '</div>',
      '<div id="schatAssistantBtn" title="Yordamchi">AI<div id="schatAssistantBadge"></div></div>'
    ].join('');
    document.body.appendChild(host);
    return host;
  }

  var state = {
    tab: 'bot',
    support: [],
    notifications: [],
    unreadSupport: 0,
    unreadNotif: 0,
    ai: { bot: [], lab: [] }
  };

  function aiTab(tab){
    return String(tab || '').toLowerCase() === 'lab' ? 'lab' : 'bot';
  }

  function getAiMessages(tab){
    var t = aiTab(tab);
    if (!state.ai[t]) state.ai[t] = [];
    return state.ai[t];
  }

  function pushAiMessage(tab, kind, text){
    var list = getAiMessages(tab);
    list.push({ kind: String(kind || 'note'), text: String(text || '').slice(0, 2400), at: Date.now() });
    if (list.length > 50) list.splice(0, list.length - 50);
  }

  function renderAiMessages(tab, introHtml){
    var list = getAiMessages(tab);
    if (!list.length) return introHtml;
    return list.map(function(m){
      var cls = (m.kind === 'user' || m.kind === 'admin' || m.kind === 'note') ? m.kind : 'note';
      return '<div class="schatMsg ' + cls + '">' + esc(m.text || '') + '</div>';
    }).join('');
  }

  function aiHistoryPayload(tab){
    return getAiMessages(tab)
      .filter(function(m){ return m.kind === 'user' || m.kind === 'admin'; })
      .slice(-10)
      .map(function(m){
        return {
          role: (m.kind === 'user') ? 'user' : 'assistant',
          content: String(m.text || '').slice(0, 1200)
        };
      });
  }

  function getLabContext(){
    var subject = String(window.__groupLiveSubject || '').trim();
    var callActive = !!window.__groupCallActive;
    var labState = (window.__groupLabState && typeof window.__groupLabState === 'object') ? window.__groupLabState : {};
    var t = subject.toLowerCase();
    var science = /fizik|physics|kimyo|chem|biolog|bio/.test(t);
    var labType = String(labState.labType || '').toLowerCase();
    return { subject: subject, callActive: callActive, science: science, labType: labType, labState: labState };
  }

  function savePos(x,y){ localStorage.setItem('schat:assistant:pos', JSON.stringify({x:x,y:y})); }
  function loadPos(){ try { return JSON.parse(localStorage.getItem('schat:assistant:pos') || 'null'); } catch(_) { return null; } }

  function bindDrag(btn){
    var dock = byId('schatAssistantDock');
    var drag = null;
    function onMove(e){
      if (!drag) return;
      var x = (e.touches?e.touches[0].clientX:e.clientX) - drag.dx;
      var y = (e.touches?e.touches[0].clientY:e.clientY) - drag.dy;
      var maxX = Math.max(8, window.innerWidth - btn.offsetWidth - 8);
      var maxY = Math.max(8, window.innerHeight - btn.offsetHeight - 8);
      x = Math.min(maxX, Math.max(8, x));
      y = Math.min(maxY, Math.max(8, y));
      dock.style.left = x + 'px';
      dock.style.top = y + 'px';
      dock.style.right = 'auto';
      dock.style.bottom = 'auto';
      drag.moved = true;
    }
    function onUp(){
      if (!drag) return;
      savePos(parseInt(dock.style.left||'0',10), parseInt(dock.style.top||'0',10));
      drag = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    }
    btn.addEventListener('mousedown', function(e){
      drag = { dx: e.clientX - btn.getBoundingClientRect().left, dy: e.clientY - btn.getBoundingClientRect().top, moved:false };
      window.addEventListener('mousemove', onMove, {passive:false});
      window.addEventListener('mouseup', onUp, {passive:true});
    });
    btn.addEventListener('touchstart', function(e){
      var t = e.touches[0];
      drag = { dx: t.clientX - btn.getBoundingClientRect().left, dy: t.clientY - btn.getBoundingClientRect().top, moved:false };
      window.addEventListener('touchmove', onMove, {passive:false});
      window.addEventListener('touchend', onUp, {passive:true});
    }, {passive:true});

    var clickTimer = 0;
    btn.addEventListener('click', function(){
      if (Date.now() - clickTimer < 120) return;
      clickTimer = Date.now();
      var p = byId('schatAssistantPanel');
      p.classList.toggle('open');
      if (p.classList.contains('open')) { refreshAll(); render(); }
    });

    var pos = loadPos();
    if (pos && isFinite(pos.x) && isFinite(pos.y)) {
      dock.style.left = pos.x + 'px';
      dock.style.top = pos.y + 'px';
      dock.style.right = 'auto';
      dock.style.bottom = 'auto';
    }
  }

  async function api(path, opts){
    var res = await fetch(path, Object.assign({}, opts || {}, {
      headers: Object.assign({}, (opts && opts.headers) || {}, { 'Authorization':'Bearer ' + token() })
    }));
    var j = await res.json().catch(function(){ return {}; });
    return {res:res, j:j};
  }

  async function loadSupport(){
    if (!hasToken()) return;
    var r = await api('/api/support/thread');
    if (r.res.ok && r.j.success) {
      state.support = Array.isArray(r.j.messages) ? r.j.messages : [];
      state.unreadSupport = Number(r.j.unreadForUser || 0);
    }
  }

  async function loadNotifications(){
    if (!hasToken()) return;
    var r = await api('/api/notifications');
    if (r.res.ok && r.j.success) {
      state.notifications = Array.isArray(r.j.notifications) ? r.j.notifications : [];
      state.unreadNotif = state.notifications.filter(function(n){ return !n.read; }).length;
    }
  }

  function badgeUpdate(){
    var n = Number(state.unreadSupport || 0) + Number(state.unreadNotif || 0);
    var b = byId('schatAssistantBadge');
    if (!b) return;
    b.style.display = n > 0 ? 'flex' : 'none';
    b.textContent = n > 99 ? '99+' : String(n);
  }

  function pushMsg(kind, text){
    var body = byId('schatABody');
    if (!body) return;
    var div = document.createElement('div');
    div.className = 'schatMsg ' + kind;
    div.innerHTML = esc(text || '');
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  function renderBot(){
    var body = byId('schatABody');
    var quick = byId('schatAQuick');
    if (!body || !quick) return;
    body.innerHTML = renderAiMessages('bot', '<div class="schatMsg note">Salom. Savol bering, men real AI orqali javob beraman. Login bo\'lmasa lokal tezkor javob rejimi ishlaydi.</div>');
    quick.innerHTML = ['Call ishlamayapti','Coin masalasi','Kurs sertifikat','Guruhga qoshilish'].map(function(t){
      return '<button class="schatQBtn" data-q="'+esc(t)+'">'+esc(t)+'</button>';
    }).join('');
    quick.querySelectorAll('.schatQBtn').forEach(function(b){ b.addEventListener('click', function(){ byId('schatAText').value = b.getAttribute('data-q'); }); });
    byId('schatAHint').textContent = hasToken()
      ? 'Real AI faol: savolni tabiiy yozing.'
      : 'Login qilinsa real AI yoqiladi. Hozir lokal tezkor javob ishlaydi.';
  }

  function renderSupport(){
    var body = byId('schatABody');
    var quick = byId('schatAQuick');
    if (!body || !quick) return;
    if (!hasToken()) {
      body.innerHTML = '<div class="schatMsg note">Admin bilan yozishish uchun avval login qiling.</div>';
      quick.innerHTML = '';
      byId('schatAHint').textContent = 'Login bo\'lmasdan support chat ishlamaydi.';
      return;
    }
    var html = '';
    state.support.forEach(function(m){
      var cls = m.senderRole === 'admin' ? 'admin' : 'user';
      var who = m.senderRole === 'admin' ? 'Admin' : 'Siz';
      html += '<div class="schatMsg '+cls+'"><div style="font-size:11px;opacity:.8;margin-bottom:4px">'+who+'</div>'+esc(m.text || '')+'</div>';
    });
    body.innerHTML = html || '<div class="schatMsg note">Hozircha xabar yo\'q.</div>';
    body.scrollTop = body.scrollHeight;
    quick.innerHTML = '<button class="schatQBtn" id="schatMarkRead">Oqilgan deb belgilash</button>';
    byId('schatMarkRead')?.addEventListener('click', async function(){
      var r = await api('/api/support/thread/read', { method:'POST' });
      if (r.res.ok) { state.unreadSupport = 0; badgeUpdate(); }
    });
    byId('schatAHint').textContent = 'Admin javobi kelganda bu yerda unread ko\'rinadi.';
  }

  function renderLabAi(){
    var body = byId('schatABody');
    var quick = byId('schatAQuick');
    if (!body || !quick) return;
    var c = getLabContext();
    if (!c.callActive) {
      body.innerHTML = renderAiMessages('lab', '<div class="schatMsg note">Lab AI jonli dars vaqtida faollashadi. Dars boshlanganda fan bo\'yicha tavsiya chiqadi.</div>');
      quick.innerHTML = '';
      byId('schatAHint').textContent = 'Call boshlanganda bu bo\'lim avtomatik moslashadi.';
      return;
    }
    if (!c.science) {
      body.innerHTML = renderAiMessages('lab', '<div class="schatMsg note">Hozirgi dars fanida laboratoriya tavsiyasi topilmadi. Fan: ' + esc(c.subject || 'noma\'lum') + '</div>');
      quick.innerHTML = '';
      byId('schatAHint').textContent = 'Fizika/Kimyo/Biologiya darsida Lab AI tajriba tavsiyalarini beradi.';
      return;
    }
    var title = c.subject || 'Science';
    var tip = 'Tajribani men bilan sinab ko\'ring.';
    if (c.labType === 'physics') tip = 'F=ma tajribasida kuch va massani o\'zgartirib natijani solishtiring.';
    if (c.labType === 'chemistry') tip = 'Kislota/ishqor nisbatini o\'zgartirib pH farqini kuzating.';
    if (c.labType === 'biology') tip = 'Mikroskop zoom/fokus bilan namuna ravshanligini tahlil qiling.';
    var intro = [
      '<div class="schatMsg admin"><div style="font-size:11px;opacity:.8;margin-bottom:4px">Lab AI</div>Fan: <b>' + esc(title) + '</b></div>',
      '<div class="schatMsg note">' + esc(tip) + '</div>',
      '<div class="schatMsg note">Agar o\'qituvchi ruxsat bersa, tajribani siz ham interaktiv boshqarishingiz mumkin.</div>'
    ].join('');
    body.innerHTML = renderAiMessages('lab', intro);
    quick.innerHTML = [
      '<button class="schatQBtn" data-q="Tajribani men bilan sinab ko\'ring">Tajriba bilan o\'rganish</button>',
      '<button class="schatQBtn" data-q="Labdagi natijani qanday tahlil qilaman?">Natijani tahlil qilish</button>'
    ].join('');
    quick.querySelectorAll('.schatQBtn').forEach(function(b){ b.addEventListener('click', function(){ byId('schatAText').value = b.getAttribute('data-q'); }); });
    byId('schatAHint').textContent = hasToken()
      ? 'Lab AI faol: real tajriba savollarini yozing.'
      : 'Login qilinsa Lab AI real model bilan ishlaydi.';
  }

  function renderNotif(){
    var body = byId('schatABody');
    var quick = byId('schatAQuick');
    if (!body || !quick) return;
    if (!hasToken()) {
      body.innerHTML = '<div class="schatMsg note">Xabarnomalarni korish uchun login qiling.</div>';
      quick.innerHTML = '';
      byId('schatAHint').textContent = 'Admin broadcast xabarlar shu bolimda chiqadi.';
      return;
    }
    var html = '';
    state.notifications.forEach(function(n){
      var cls = n.read ? 'note' : 'admin';
      html += '<div class="schatMsg '+cls+'"><div style="font-size:11px;opacity:.8;margin-bottom:4px">'+esc(n.title || 'Xabarnoma')+'</div>'+esc(n.body || '')+'</div>';
    });
    body.innerHTML = html || '<div class="schatMsg note">Xabarnoma yo\'q.</div>';
    quick.innerHTML = '<button class="schatQBtn" id="schatReadAll">Barchasini oqish</button>';
    byId('schatReadAll')?.addEventListener('click', async function(){
      var r = await api('/api/notifications/read-all', { method:'POST' });
      if (r.res.ok) {
        state.notifications = state.notifications.map(function(n){ n.read = true; return n; });
        state.unreadNotif = 0;
        badgeUpdate();
        renderNotif();
      }
    });
    byId('schatAHint').textContent = 'Admin broadcast va tizim xabarlari.';
  }

  function render(){
    // Keep panel closed by default; open only on user click.
    document.querySelectorAll('.schatATab').forEach(function(t){ t.classList.toggle('active', t.getAttribute('data-tab') === state.tab); });
    if (state.tab === 'bot') renderBot();
    else if (state.tab === 'lab') renderLabAi();
    else if (state.tab === 'support') renderSupport();
    else renderNotif();
    badgeUpdate();
  }

  async function refreshAll(){
    await Promise.all([loadSupport(), loadNotifications()]);
    badgeUpdate();
  }

  async function sendBot(){
    var input = byId('schatAText');
    var text = (input && input.value || '').trim();
    if (!text) return;
    var tab = aiTab(state.tab);
    input.value = '';
    pushAiMessage(tab, 'user', text);
    render();

    if (!hasToken()) {
      if (tab === 'lab') pushAiMessage(tab, 'note', 'Real Lab AI uchun login qiling. Hozir lokal maslahat: ' + findKeywordAnswer(text));
      else pushAiMessage(tab, 'admin', findKeywordAnswer(text));
      render();
      return;
    }

    pushAiMessage(tab, 'note', 'AI o\'ylayapti...');
    render();
    try {
      var c = getLabContext();
      var payload = {
        mode: tab,
        message: text,
        context: {
          subject: c.subject || '',
          callActive: !!c.callActive,
          science: !!c.science,
          labType: c.labType || ''
        },
        history: aiHistoryPayload(tab)
      };
      var r = await api('/api/assistant/ai', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });

      // remove loading bubble
      var list = getAiMessages(tab);
      if (list.length && list[list.length - 1].text === 'AI o\'ylayapti...') list.pop();

      if (!r.res.ok || !r.j || !r.j.success) {
        var errText = (r.j && r.j.error) ? String(r.j.error) : 'AI javob bermadi.';
        pushAiMessage(tab, 'note', errText);
        if (tab === 'bot') pushAiMessage(tab, 'admin', findKeywordAnswer(text));
      } else {
        var ans = String(r.j.answer || '').trim();
        if (!ans) ans = 'AI hozircha qisqa javob berdi. Savolni biroz aniqroq yozing.';
        pushAiMessage(tab, 'admin', ans);
      }
    } catch (_) {
      var list2 = getAiMessages(tab);
      if (list2.length && list2[list2.length - 1].text === 'AI o\'ylayapti...') list2.pop();
      pushAiMessage(tab, 'note', 'Tarmoq xatosi. Qayta urinib ko\'ring.');
      if (tab === 'bot') pushAiMessage(tab, 'admin', findKeywordAnswer(text));
    }
    render();
  }

  async function sendAdmin(){
    var input = byId('schatAText');
    var text = (input && input.value || '').trim();
    if (!text) return;
    if (!hasToken()) {
      pushMsg('note', 'Adminga yozishish uchun avval login qiling.');
      return;
    }
    input.value = '';
    var r = await api('/api/support/thread', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text:text }) });
    if (!r.res.ok) {
      pushMsg('note', (r.j && r.j.error) ? r.j.error : 'Xabar yuborilmadi.');
      return;
    }
    await loadSupport();
    state.tab = 'support';
    render();
  }

  function bindUI(){
    var panel = byId('schatAssistantPanel');
    byId('schatAClose')?.addEventListener('click', function(){ panel.classList.remove('open'); });
    document.querySelectorAll('.schatATab').forEach(function(t){
      t.addEventListener('click', async function(){
        state.tab = t.getAttribute('data-tab') || 'bot';
        await refreshAll();
        render();
      });
    });
    byId('schatASend')?.addEventListener('click', sendBot);
    byId('schatASendAdmin')?.addEventListener('click', sendAdmin);
    byId('schatAText')?.addEventListener('keydown', function(e){
      if (e.key !== 'Enter') return;
      if (state.tab === 'support') sendAdmin();
      else sendBot();
    });
  }

  function tryBindSocket(){
    if (typeof io !== 'function' || !hasToken()) return;
    try {
      var s = io({ transports:['websocket','polling'] });
      s.emit('authenticate', token());
      s.on('notification', async function(){ await loadNotifications(); badgeUpdate(); if (state.tab === 'notif') renderNotif(); });
      s.on('support:message', async function(){ await loadSupport(); badgeUpdate(); if (state.tab === 'support') renderSupport(); });
    } catch(_) {}
  }

  function init(){
    injectStyle();
    moveBottomMenuToTop();
    createDock();
    bindDrag(byId('schatAssistantBtn'));
    bindUI();
    refreshAll().then(render);
    tryBindSocket();
    setInterval(function(){ refreshAll(); }, 20000);
    window.addEventListener('resize', moveBottomMenuToTop, {passive:true});
    window.addEventListener('schat:lab-context', function(){ if (state.tab === 'lab') renderLabAi(); }, {passive:true});
    setTimeout(moveBottomMenuToTop, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
