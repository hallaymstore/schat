(function () {
  'use strict';

  const VOICE_LANG = 'uz-UZ';
  const LAST_GROUP_KEY = 'hallaym:last-group-id';
  const VOICE_ENABLED_KEY = 'hallaym:voice-assistant-enabled';
  const CAPTIONS_ENABLED_KEY = 'hallaym:captions-enabled';
  const GESTURE_ENABLED_KEY = 'hallaym:gesture-enabled';
  const NAV_GESTURE_ENABLED_KEY = 'hallaym:navigation-gesture-enabled';
  const TASKS_VERSION = '0.10.22-rc.20250304';
  const TASKS_MODULE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/+esm`;
  const TASKS_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
  const HAND_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const FACE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

  const voiceState = {
    recognition: null,
    desired: false,
    listening: false,
    speaking: false,
    processing: false,
    lastCommand: '',
    lastCommandAt: 0,
    restartTimer: null,
    suspendedForSpeech: false,
    suppressUntil: 0
  };

  const gestureState = {
    enabled: false,
    loading: false,
    hand: null,
    face: null,
    rafId: 0,
    lastDetectAt: 0,
    lastEmitAt: 0,
    lastMode: '',
    modeSince: 0,
    frozen: false,
    fistStartAngle: null,
    fistStartAt: 0,
    lastShapeAt: 0,
    lastDrawPoint: null,
    remoteBound: false,
    hint: 'AI imo o‘chiq'
  };

  const navigationGestureState = {
    enabled: false,
    stream: null,
    video: null,
    rafId: 0,
    lastDetectAt: 0,
    lastMode: '',
    modeSince: 0,
    lastActionAt: 0,
    target: null,
    busy: false,
    borrowedCamera: false,
    waveAnchor: null,
    lastWaveAt: 0,
    focusIndex: -1
  };

  function byId(id) { return document.getElementById(id); }
  function text(value) { return String(value == null ? '' : value); }
  function clamp(value, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
  }
  function token() {
    return localStorage.getItem('token') || localStorage.getItem('accessToken') || '';
  }
  function apiHeaders(extra) {
    const auth = token();
    return Object.assign({}, extra || {}, auth ? { Authorization: `Bearer ${auth}` } : {});
  }
  function normalizeWords(value) {
    return text(value)
      .toLowerCase()
      .replace(/[ʻ’`]/g, "'")
      .replace(/[^a-zа-яё0-9+'\s-]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function currentGroupId() {
    const fromUrl = new URLSearchParams(location.search).get('id') || new URLSearchParams(location.search).get('groupId') || '';
    if (fromUrl) {
      try { localStorage.setItem(LAST_GROUP_KEY, fromUrl); } catch (_) {}
      return fromUrl;
    }
    try { return localStorage.getItem(LAST_GROUP_KEY) || ''; } catch (_) { return ''; }
  }
  function isGroupPage() { return !!byId('messageInput') && !!byId('groupCallOverlay'); }
  function currentRole() {
    try { return text(typeof currentUser !== 'undefined' ? currentUser?.role : '').toLowerCase(); } catch (_) { return ''; }
  }
  function isTeacher() {
    const role = currentRole();
    return role === 'teacher' || role === 'admin' || role === 'organizer';
  }

  function setVoiceStatus(message, kind) {
    const status = byId('eduVoiceStatus');
    const live = byId('eduVoiceLive');
    if (status) {
      status.textContent = text(message || 'Tayyor');
      status.dataset.kind = text(kind || 'idle');
    }
    if (live) live.textContent = text(message || '');
  }

  function preferredSpeechVoice() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    return voices.find((voice) => /^uz[-_]/i.test(voice.lang || ''))
      || voices.find((voice) => /^ru[-_]/i.test(voice.lang || ''))
      || voices.find((voice) => /^tr[-_]/i.test(voice.lang || ''))
      || voices.find((voice) => /^en[-_]/i.test(voice.lang || ''))
      || voices[0]
      || null;
  }

  function speak(message, options) {
    const clean = text(message).replace(/\s+/g, ' ').trim();
    if (!clean || !('speechSynthesis' in window)) return Promise.resolve(false);
    const opts = options || {};
    if (opts.interrupt !== false) window.speechSynthesis.cancel();
    voiceState.speaking = true;
    voiceState.suspendedForSpeech = !!voiceState.desired;
    voiceState.suppressUntil = Date.now() + Math.max(1400, clean.length * 72);
    clearTimeout(voiceState.restartTimer);
    if (voiceState.recognition && voiceState.listening) {
      try { voiceState.recognition.abort(); } catch (_) {}
    }
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(clean);
      const voice = preferredSpeechVoice();
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang || VOICE_LANG;
      } else {
        utterance.lang = VOICE_LANG;
      }
      utterance.rate = clamp(opts.rate || 0.94, 0.65, 1.25);
      utterance.pitch = 1;
      utterance.volume = 1;
      const finish = (ok) => {
        voiceState.speaking = false;
        voiceState.suppressUntil = Date.now() + 900;
        clearTimeout(voiceState.restartTimer);
        voiceState.restartTimer = setTimeout(() => {
          voiceState.suspendedForSpeech = false;
          if (voiceState.desired && !voiceState.listening) {
            try { voiceState.recognition?.start?.(); } catch (_) {}
          }
        }, 920);
        resolve(ok);
      };
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      window.speechSynthesis.speak(utterance);
    });
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, Object.assign({}, options || {}, {
      headers: apiHeaders(options?.headers)
    }));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
    return payload;
  }

  async function getPrimaryGroup() {
    const remembered = currentGroupId();
    if (remembered) return { _id: remembered };
    const result = await fetchJson('/api/groups');
    const groups = Array.isArray(result?.groups) ? result.groups : [];
    if (!groups.length) throw new Error('Siz birorta guruhga biriktirilmagansiz');
    const group = groups[0];
    if (group?._id) localStorage.setItem(LAST_GROUP_KEY, text(group._id));
    return group;
  }

  async function openMyGroup() {
    const group = await getPrimaryGroup();
    if (!group?._id) throw new Error('Guruh topilmadi');
    await speak(`${text(group.name || 'Guruhingiz')} ochilmoqda`);
    location.href = `/group.html?id=${encodeURIComponent(group._id)}`;
  }

  async function findActiveLesson() {
    const result = await fetchJson('/api/groups');
    const groups = Array.isArray(result?.groups) ? result.groups.slice(0, 20) : [];
    const remembered = currentGroupId();
    groups.sort((a, b) => (text(a?._id) === remembered ? -1 : text(b?._id) === remembered ? 1 : 0));
    const lessonResults = await Promise.all(groups.map(async (group) => {
      try {
        const payload = await fetchJson(`/api/group-lessons?groupId=${encodeURIComponent(group._id)}`);
        const lessons = Array.isArray(payload?.lessons) ? payload.lessons : [];
        const lesson = lessons.find((item) => ['live', 'waiting'].includes(text(item?.status).toLowerCase()));
        return lesson ? { group, lesson } : null;
      } catch (_) {
        return null;
      }
    }));
    return lessonResults.find(Boolean) || null;
  }

  async function joinCurrentLesson() {
    try {
      if (isGroupPage()) {
        if (typeof groupCall !== 'undefined' && groupCall?.active) {
          return speak('Siz allaqachon videodarsdasiz');
        }
        if (typeof groupCall !== 'undefined' && groupCall?.incoming && typeof acceptIncomingGroupCall === 'function') {
          await speak('Videodarsga qo‘shilmoqda');
          await acceptIncomingGroupCall();
          return;
        }
      }
    } catch (_) {}

    const active = await findActiveLesson();
    if (!active?.group?._id) throw new Error('Hozir faol videodars topilmadi');
    localStorage.setItem(LAST_GROUP_KEY, text(active.group._id));
    await speak(`${text(active.lesson?.title || 'Videodars')}ga qo‘shilmoqda`);
    location.href = `/group.html?id=${encodeURIComponent(active.group._id)}&autoJoin=1`;
  }

  async function sendVoiceChat(message) {
    const clean = text(message).trim();
    if (!clean) throw new Error('Yuboriladigan xabarni ayting');
    if (isGroupPage() && byId('messageInput') && typeof sendGroupMessage === 'function') {
      const input = byId('messageInput');
      input.value = clean;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sendGroupMessage();
      await speak('Xabar yuborildi');
      return;
    }
    const group = await getPrimaryGroup();
    sessionStorage.setItem('hallaym:pending-voice-message', clean);
    await speak('Guruh chatiga o‘tilmoqda');
    location.href = `/group.html?id=${encodeURIComponent(group._id)}&voiceMessage=1`;
  }

  function senderName(message) {
    const sender = message?.senderId || message?.sender || {};
    return text(sender?.nickname || sender?.fullName || sender?.username || message?.senderName || 'Noma’lum foydalanuvchi');
  }

  async function readRecentMessages(count = 3) {
    const limit = Math.max(1, Math.min(10, Number(count || 3)));
    const group = await getPrimaryGroup();
    const payload = await fetchJson(`/api/groups/${encodeURIComponent(group._id)}/messages?limit=${limit}`);
    const messages = Array.isArray(payload?.messages) ? payload.messages.slice(-limit) : [];
    if (!messages.length) throw new Error('Guruhda o‘qiladigan xabar yo‘q');
    const lines = messages.map((message, index) => {
      const body = text(message?.text || message?.message || message?.caption || 'Media xabar').trim() || 'Media xabar';
      return `${index + 1}. ${senderName(message)} yozdi: ${body}`;
    });
    await speak(`Oxirgi ${messages.length} ta xabar. ${lines.join('. ')}`, { rate: 0.9 });
  }

  function captionEnabled() {
    try { return localStorage.getItem(CAPTIONS_ENABLED_KEY) !== '0'; } catch (_) { return true; }
  }

  function setCaptionsEnabled(enabled, announceChange) {
    const next = !!enabled;
    localStorage.setItem(CAPTIONS_ENABLED_KEY, next ? '1' : '0');
    document.documentElement.dataset.eduCaptions = next ? 'on' : 'off';
    const buttons = document.querySelectorAll('.edu-caption-tool');
    buttons.forEach((button) => {
      button.classList.toggle('active', next);
      button.setAttribute('aria-pressed', next ? 'true' : 'false');
      button.title = next ? 'Jonli subtitrlarni o‘chirish' : 'Jonli subtitrlarni yoqish';
    });
    try {
      if (typeof _captionTranscriberEnabled !== 'undefined') _captionTranscriberEnabled = next;
      if (next && typeof syncLiveCaptionTranscriber === 'function') syncLiveCaptionTranscriber();
      if (!next && typeof stopLiveCaptionTranscriber === 'function') stopLiveCaptionTranscriber();
    } catch (_) {}
    const captionNodes = [byId('stageCaptionBar'), byId('stageCaptionInlineBar'), byId('stageCaptionLangRow')];
    captionNodes.forEach((node) => { if (node) node.style.display = next ? '' : 'none'; });
    if (announceChange) speak(next ? 'Jonli subtitrlar yoqildi' : 'Jonli subtitrlar o‘chirildi');
  }

  function toggleCaptions() { setCaptionsEnabled(!captionEnabled(), true); }

  function navigateTo(path, label) {
    speak(`${label || 'Sahifa'} ochilmoqda`);
    location.href = path;
  }

  function setThemeMode(mode) {
    const next = mode === 'dark' ? 'dark' : 'light';
    document.documentElement.classList.toggle('dark', next === 'dark');
    localStorage.setItem('theme', next);
    document.getElementById('themeToggle')?.dispatchEvent(new Event('change', { bubbles: true }));
    return speak(next === 'dark' ? 'Tungi mavzu yoqildi' : 'Kunduzgi mavzu yoqildi');
  }

  function setCameraState(enabled) {
    if (typeof toggleCamera !== 'function' || typeof groupCall === 'undefined') throw new Error('Kamera boshqaruvi faqat videodars ichida ishlaydi');
    const hasLive = !!groupCall?.localStream?.getVideoTracks?.().some((track) => track && track.readyState === 'live' && track.enabled !== false);
    if (!!enabled !== hasLive) toggleCamera();
    return speak(enabled ? 'Kamera yoqilmoqda' : 'Kamera o‘chirilmoqda');
  }

  function setMicrophoneState(enabled) {
    if (typeof toggleMute !== 'function' || typeof groupCall === 'undefined') throw new Error('Mikrofon boshqaruvi faqat videodars ichida ishlaydi');
    const hasLive = !!groupCall?.localStream?.getAudioTracks?.().some((track) => track && track.readyState === 'live' && track.enabled !== false);
    if (!!enabled !== hasLive) toggleMute();
    return speak(enabled ? 'Mikrofon yoqilmoqda' : 'Mikrofon o‘chirilmoqda');
  }

  function setCaptionLanguage(lang) {
    const value = lang === 'ru' ? 'ru' : lang === 'en' ? 'en' : 'uz';
    localStorage.setItem('schat:caption-target-lang', value);
    const select = byId('captionLangSelect');
    if (select) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const names = { uz: 'O‘zbek', ru: 'Rus', en: 'Ingliz' };
    return speak(`Subtitr tili ${names[value]} tiliga o‘zgartirildi`);
  }

  function scrollPage(direction) {
    if (direction === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
    else if (direction === 'bottom') window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    else window.scrollBy({ top: direction === 'up' ? -Math.max(320, innerHeight * .72) : Math.max(320, innerHeight * .72), behavior: 'smooth' });
  }

  function focusInteractive(direction) {
    const items = Array.from(document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])'))
      .filter((item) => item.offsetParent !== null && item.getAttribute('aria-hidden') !== 'true');
    if (!items.length) throw new Error('Tanlanadigan element topilmadi');
    const current = items.indexOf(document.activeElement);
    const index = direction === 'previous' ? (current <= 0 ? items.length - 1 : current - 1) : (current + 1) % items.length;
    items[index].focus({ preventScroll: false });
    items[index].scrollIntoView({ block: 'center', behavior: 'smooth' });
    const label = items[index].getAttribute('aria-label') || items[index].title || items[index].innerText || items[index].placeholder || 'element';
    speak(text(label).trim().slice(0, 90));
  }

  function activateFocused() {
    const active = document.activeElement;
    if (!active || active === document.body || typeof active.click !== 'function') throw new Error('Avval keyingi tugma deb elementni tanlang');
    active.click();
  }

  function speakPageSummary() {
    const title = text(document.querySelector('h1')?.textContent || document.querySelector('h2')?.textContent || document.title).trim();
    const description = text(document.querySelector('main p')?.textContent || '').trim();
    return speak(`${title}. ${description}`.slice(0, 700), { rate: .9 });
  }

  async function handleVoiceCommand(rawCommand) {
    const command = normalizeWords(rawCommand);
    if (!command) return;
    const now = Date.now();
    if (command === voiceState.lastCommand && now - voiceState.lastCommandAt < 1400) return;
    voiceState.lastCommand = command;
    voiceState.lastCommandAt = now;
    setVoiceStatus(`Buyruq: ${rawCommand}`, 'processing');

    if (/^(to'xta|jim bo'l|ovozni to'xtat|o'qishni to'xtat)$/.test(command)) {
      window.speechSynthesis?.cancel?.();
      setVoiceStatus('Ovoz to‘xtatildi', 'ok');
      return;
    }

    voiceState.processing = true;
    try {
      if (/yordam|buyruq(lar)?/.test(command)) {
        byId('eduVoiceHelp')?.removeAttribute('hidden');
        await speak('Asosiy buyruqlar: bosh sahifa, guruhlar, guruhimga kir, darsga qo‘shil, chatga yoz, xabarlarni o‘qi, jadval, profil, kunduzgi yoki tungi mavzu, pastga yur, keyingi tugma, tanla. Videodarsda kamera, mikrofon, subtitr, oq doska, qalam, shakl, ekran, davomat, yozib olish va to‘liq ekran buyruqlari ishlaydi.');
      } else if (/^(bosh sahifa|asosiy sahifa|uyga qayt|boshga qayt|asosiyga o't)$/.test(command)) {
        navigateTo('/', 'Bosh sahifa');
      } else if (/^(guruhlar|guruhlar sahifasi)$/.test(command)) {
        navigateTo('/groups.html', 'Guruhlar');
      } else if (/^(xabarlar|xabarlar sahifasi|chatlar)$/.test(command)) {
        navigateTo('/messages.html', 'Xabarlar');
      } else if (/^(kurslar|kurslar sahifasi)$/.test(command)) {
        navigateTo('/courses.html', 'Kurslar');
      } else if (/^(jadval|dars jadvali|jadvalni och)$/.test(command)) {
        navigateTo('/schedule.html', 'Dars jadvali');
      } else if (/^(profil|profilim|profilni och)$/.test(command)) {
        navigateTo('/profile.html', 'Profil');
      } else if (/^(bildirishnomalar|xabarnomalar|notification)$/.test(command)) {
        navigateTo('/notification-center.html', 'Bildirishnomalar');
      } else if (/^(sozlamalar|sozlamani och)$/.test(command)) {
        navigateTo('/settings-center.html', 'Sozlamalar');
      } else if (/^(qo'llanma|yordam markazi)$/.test(command)) {
        navigateTo('/guide.html', 'Qo‘llanma');
      } else if (/^(kirish|login|hisobga kir)$/.test(command)) {
        navigateTo('/login.html', 'Kirish sahifasi');
      } else if (/ro'yxatdan o't|registratsiya/.test(command)) {
        navigateTo('/register.html', 'Ro‘yxatdan o‘tish');
      } else if (/^(orqaga|oldingi sahifa)$/.test(command)) {
        history.back();
      } else if (/guruh(im)?ga (kir|o't|ot|o'tgin)|guruhni och|mening guruhim|o'z guruhim/.test(command)) {
        await openMyGroup();
      } else if (/darsga (qo'shil|qoshil|kir|ulanish)|video ?dars(ga|ni)? (qo'shil|qoshil|kir|och)|jonli darsga kir/.test(command)) {
        await joinCurrentLesson();
      } else if (/^(chatga|guruhga|xabar) (yoz|jo'nat|jonat|yubor)\s+/.test(command)) {
        await sendVoiceChat(rawCommand.replace(/^\s*(chatga|guruhga|xabar)\s+(yoz|jo['’]?nat|jonat|yubor)\s+/i, ''));
      } else if (/oxirgi.*(chat|xabar)|xabarlarni o'qi|chatni o'qib ber|so'nggi xabar/.test(command)) {
        const countMatch = command.match(/\b(10|[1-9])\b/);
        const wordCount = /beshta/.test(command) ? 5 : /to'rtta/.test(command) ? 4 : /uchta/.test(command) ? 3 : /ikkita/.test(command) ? 2 : 3;
        await readRecentMessages(countMatch ? Number(countMatch[1]) : wordCount);
      } else if (/tungi (mavzu|rejim)(ni)? yoq|qora (mavzu|fon)/.test(command)) {
        await setThemeMode('dark');
      } else if (/kunduzgi (mavzu|rejim)(ni)? yoq|oq (mavzu|fon)/.test(command)) {
        await setThemeMode('light');
      } else if (/^(pastga|pastga yur|pastga tush)$/.test(command)) {
        scrollPage('down');
      } else if (/^(tepaga|yuqoriga|yuqoriga yur)$/.test(command)) {
        scrollPage('up');
      } else if (/^(sahifa boshi|eng tepaga)$/.test(command)) {
        scrollPage('top');
      } else if (/^(sahifa oxiri|eng pastga)$/.test(command)) {
        scrollPage('bottom');
      } else if (/^(keyingi tugma|keyingi element|navbatdagi tugma|oldinga o't)$/.test(command)) {
        focusInteractive('next');
      } else if (/^(oldingi tugma|oldingi element)$/.test(command)) {
        focusInteractive('previous');
      } else if (/^(tanla|bos|och)$/.test(command)) {
        activateFocused();
      } else if (/sahifani o'qi|bu sahifa nima/.test(command)) {
        await speakPageSummary();
      } else if (/navigatsiya imo(ni)? yoq|kamera bilan boshqar/.test(command)) {
        await setNavigationGesturesEnabled(true, true);
      } else if (/navigatsiya imo(ni)? o'chir|kamera boshqaruvini o'chir/.test(command)) {
        await setNavigationGesturesEnabled(false, true);
      } else if (/subtitr(lar)?ni yoq/.test(command)) {
        setCaptionsEnabled(true, true);
      } else if (/subtitr(lar)?ni o'chir/.test(command)) {
        setCaptionsEnabled(false, true);
      } else if (/subtitr.*(o'zbek|uzbek)/.test(command)) {
        await setCaptionLanguage('uz');
      } else if (/subtitr.*(rus|russian)/.test(command)) {
        await setCaptionLanguage('ru');
      } else if (/subtitr.*(ingliz|english)/.test(command)) {
        await setCaptionLanguage('en');
      } else if (/oq doskani och|doska(ni)? yoq|doskani ko'rsat/.test(command)) {
        if (!isGroupPage() || typeof toggleStageWhiteboard !== 'function') throw new Error('Oq doska faqat videodars ichida ochiladi');
        await toggleStageWhiteboard(true);
        await speak('Oq doska ochildi');
      } else if (/oq doskani yop|doska(ni)? o'chir/.test(command)) {
        if (!isGroupPage() || typeof toggleStageWhiteboard !== 'function') throw new Error('Oq doska hozir mavjud emas');
        await toggleStageWhiteboard(false);
        await speak('Oq doska yopildi');
      } else if (/doska(ni)? tozala/.test(command)) {
        if (typeof clearStageWhiteboard !== 'function') throw new Error('Oq doska ochilmagan');
        clearStageWhiteboard();
        await speak('Oq doska tozalandi');
      } else if (/doska.*undo|oxirgi chiziqni qaytar|bekor qil/.test(command)) {
        if (typeof undoStageWhiteboard !== 'function') throw new Error('Oq doska ochilmagan');
        await undoStageWhiteboard();
      } else if (/doska.*redo|qayta tikla/.test(command)) {
        if (typeof redoStageWhiteboard !== 'function') throw new Error('Oq doska ochilmagan');
        await redoStageWhiteboard();
      } else if (/doska(ni)?.*(kattalashtir|to'liq qil|katta qil)/.test(command)) {
        if (typeof toggleStageWhiteboardPipSize !== 'function') throw new Error('Oq doska ochilmagan');
        toggleStageWhiteboardPipSize(true);
      } else if (/doska(ni)?.*(kichraytir|pip qil|kichik qil)/.test(command)) {
        if (typeof toggleStageWhiteboardPipSize !== 'function') throw new Error('Oq doska ochilmagan');
        toggleStageWhiteboardPipSize(false);
      } else if (/(shakl|obyekt).*(kattalashtir|katta qil)/.test(command)) {
        if (typeof transformSelectedStageWhiteboardObject !== 'function') throw new Error('Avval doskadagi shaklni tanlang');
        transformSelectedStageWhiteboardObject('larger');
      } else if (/(shakl|obyekt).*(kichraytir|kichik qil)/.test(command)) {
        if (typeof transformSelectedStageWhiteboardObject !== 'function') throw new Error('Avval doskadagi shaklni tanlang');
        transformSelectedStageWhiteboardObject('smaller');
      } else if (/(shakl|obyekt).*(chapga aylantir)/.test(command)) {
        transformSelectedStageWhiteboardObject('rotateLeft');
      } else if (/(shakl|obyekt).*(o'ngga aylantir|aylantir)/.test(command)) {
        transformSelectedStageWhiteboardObject('rotateRight');
      } else if (/doska.*qalam|qalamni tanla/.test(command)) {
        if (typeof setStageWhiteboardTool !== 'function') throw new Error('Oq doska ochilmagan');
        setStageWhiteboardTool('pen');
      } else if (/doska.*o'chirgich|o'chirgichni tanla/.test(command)) {
        if (typeof setStageWhiteboardTool !== 'function') throw new Error('Oq doska ochilmagan');
        setStageWhiteboardTool('eraser');
      } else if (/doska.*matn|matn asbobi/.test(command)) {
        if (typeof setStageWhiteboardTool !== 'function') throw new Error('Oq doska ochilmagan');
        setStageWhiteboardTool('text');
      } else if (/doska.*(to'rtburchak|kvadrat)/.test(command)) {
        if (typeof setStageWhiteboardTool !== 'function') throw new Error('Oq doska ochilmagan');
        setStageWhiteboardTool('rectangle');
      } else if (/doska.*doira/.test(command)) {
        if (typeof setStageWhiteboardTool !== 'function') throw new Error('Oq doska ochilmagan');
        setStageWhiteboardTool('circle');
      } else if (/doska.*strelka/.test(command)) {
        if (typeof setStageWhiteboardTool !== 'function') throw new Error('Oq doska ochilmagan');
        setStageWhiteboardTool('arrow');
      } else if (/doska.*chiziq/.test(command)) {
        if (typeof setStageWhiteboardTool !== 'function') throw new Error('Oq doska ochilmagan');
        setStageWhiteboardTool('line');
      } else if (/doska.*qizil/.test(command)) {
        if (typeof setStageWhiteboardColor !== 'function') throw new Error('Oq doska ochilmagan');
        setStageWhiteboardColor('#ef4444');
      } else if (/doska.*ko'k/.test(command)) {
        if (typeof setStageWhiteboardColor !== 'function') throw new Error('Oq doska ochilmagan');
        setStageWhiteboardColor('#176fae');
      } else if (/doska.*yashil/.test(command)) {
        if (typeof setStageWhiteboardColor !== 'function') throw new Error('Oq doska ochilmagan');
        setStageWhiteboardColor('#0d8b75');
      } else if (/doska.*(sariq|to'q sariq)/.test(command)) {
        if (typeof setStageWhiteboardColor !== 'function') throw new Error('Oq doska ochilmagan');
        setStageWhiteboardColor('#f59e0b');
      } else if (/doska.*qora/.test(command)) {
        if (typeof setStageWhiteboardColor !== 'function') throw new Error('Oq doska ochilmagan');
        setStageWhiteboardColor('#111827');
      } else if (/kamera(ni)? yoq/.test(command)) {
        await setCameraState(true);
      } else if (/kamera(ni)? o'chir/.test(command)) {
        await setCameraState(false);
      } else if (/(mikrofon|mikrafon)(ni)? yoq/.test(command)) {
        await setMicrophoneState(true);
      } else if (/(mikrofon|mikrafon)(ni)? o'chir/.test(command)) {
        await setMicrophoneState(false);
      } else if (/ekran(ni)? ulash|ekranni ko'rsat/.test(command)) {
        if (typeof startScreenWithCam !== 'function') throw new Error('Ekran ulashish videodars ichida ishlaydi');
        await startScreenWithCam();
      } else if (/ekran ulashishni to'xtat|ekranni yop/.test(command)) {
        if (typeof stopComposite !== 'function') throw new Error('Ekran hozir ulashilmagan');
        stopComposite();
      } else if (/davomat(ni)? (och|ko'rsat)/.test(command)) {
        if (typeof toggleAttendancePanel !== 'function') throw new Error('Davomat faqat videodars ichida mavjud');
        toggleAttendancePanel(true);
      } else if (/talabalar(ni)? (ko'rsat|och)|ishtirokchilar(ni)? (ko'rsat|och)/.test(command)) {
        const students = byId('studentsScrollArea');
        if (!students) throw new Error('Talabalar paneli topilmadi');
        students.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        students.focus?.({ preventScroll: true });
      } else if (/chat(ni)? (och|ko'rsat)|xabar yozish joyi/.test(command)) {
        const input = byId('messageInput');
        if (!input) throw new Error('Chat maydoni topilmadi');
        input.focus();
      } else if (/yozib olishni boshla|darsni yoz/.test(command)) {
        if (typeof toggleRecording !== 'function') throw new Error('Yozib olish faqat o‘qituvchi uchun');
        toggleRecording();
      } else if (/to'liq ekran|fullscreen/.test(command)) {
        if (typeof toggleTeacherFullscreen !== 'function') throw new Error('To‘liq ekran videodars ichida ishlaydi');
        toggleTeacherFullscreen();
      } else if (/yaqinlashtir|zoom in/.test(command)) {
        if (typeof zoomTeacherStageBy !== 'function') throw new Error('Kamera sahnasi topilmadi');
        zoomTeacherStageBy(.35);
      } else if (/uzoqlashtir|zoom out/.test(command)) {
        if (typeof zoomTeacherStageBy !== 'function') throw new Error('Kamera sahnasi topilmadi');
        zoomTeacherStageBy(-.35);
      } else if (/zoomni tikla|to'liq kadr/.test(command)) {
        if (typeof resetTeacherStageZoom !== 'function') throw new Error('Kamera sahnasi topilmadi');
        resetTeacherStageZoom();
      } else if (/darsdan chiq|videodarsdan chiq/.test(command)) {
        if (typeof leaveOrEndGroupCall !== 'function') throw new Error('Siz videodarsda emassiz');
        leaveOrEndGroupCall();
      } else if (/imo( ishora)?(ni)? yoq|ai imo(ni)? yoq/.test(command)) {
        await setGestureEnabled(true, true);
      } else if (/imo( ishora)?(ni)? o'chir|ai imo(ni)? o'chir/.test(command)) {
        await setGestureEnabled(false, true);
      } else {
        await speak('Buyruq tushunilmadi. Yordam desangiz, mavjud buyruqlarni aytaman.');
      }
      setVoiceStatus('Buyruq bajarildi', 'ok');
    } catch (error) {
      const message = text(error?.message || error || 'Buyruq bajarilmadi');
      setVoiceStatus(message, 'error');
      await speak(message);
    } finally {
      voiceState.processing = false;
    }
  }

  function createVoiceRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return null;
    const recognition = new Recognition();
    recognition.lang = VOICE_LANG;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      voiceState.listening = true;
      byId('eduVoiceBtn')?.setAttribute('aria-pressed', 'true');
      setVoiceStatus('Tinglayapman…', 'listening');
    };
    recognition.onresult = (event) => {
      if (voiceState.speaking || voiceState.suspendedForSpeech || Date.now() < Number(voiceState.suppressUntil || 0)) return;
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const alternative = event.results[index]?.[0];
        const transcript = text(alternative?.transcript).trim();
        const confidence = Number(alternative?.confidence || 0);
        if (event.results[index].isFinal && (!confidence || confidence >= .36)) handleVoiceCommand(transcript);
        else interim += `${transcript} `;
      }
      if (interim.trim() && !voiceState.processing) setVoiceStatus(interim.trim(), 'hearing');
    };
    recognition.onerror = (event) => {
      const code = text(event?.error || 'unknown');
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        voiceState.desired = false;
        localStorage.setItem(VOICE_ENABLED_KEY, '0');
        setVoiceStatus('Mikrofon ruxsati berilmadi', 'error');
      } else if (code !== 'no-speech' && code !== 'aborted') {
        setVoiceStatus(`Ovoz xatosi: ${code}`, 'error');
      }
    };
    recognition.onend = () => {
      voiceState.listening = false;
      byId('eduVoiceBtn')?.setAttribute('aria-pressed', 'false');
      if (voiceState.desired) {
        clearTimeout(voiceState.restartTimer);
        const restart = () => {
          if (!voiceState.desired) return;
          if (voiceState.speaking || voiceState.suspendedForSpeech || Date.now() < Number(voiceState.suppressUntil || 0)) {
            voiceState.restartTimer = setTimeout(restart, 350);
            return;
          }
          try { recognition.start(); } catch (_) {}
        };
        voiceState.restartTimer = setTimeout(restart, 550);
      } else {
        setVoiceStatus('Ovozli yordamchi o‘chiq', 'idle');
      }
    };
    return recognition;
  }

  function setVoiceEnabled(enabled) {
    const next = !!enabled;
    voiceState.desired = next;
    localStorage.setItem(VOICE_ENABLED_KEY, next ? '1' : '0');
    if (!voiceState.recognition) voiceState.recognition = createVoiceRecognition();
    if (!voiceState.recognition) {
      setVoiceStatus('Bu brauzer ovozli buyruqlarni qo‘llamaydi. Chrome yoki Edge ishlating.', 'error');
      return;
    }
    if (next) {
      try { voiceState.recognition.start(); } catch (_) {}
    } else {
      clearTimeout(voiceState.restartTimer);
      try { voiceState.recognition.stop(); } catch (_) {}
      byId('eduVoiceBtn')?.setAttribute('aria-pressed', 'false');
      setVoiceStatus('Ovozli yordamchi o‘chiq', 'idle');
    }
  }

  function createVoiceUi() {
    if (byId('eduVoiceDock')) return;
    const dock = document.createElement('div');
    dock.id = 'eduVoiceDock';
    dock.setAttribute('role', 'region');
    dock.setAttribute('aria-label', 'Ovozli yordamchi');
    dock.innerHTML = `
      <button id="eduVoiceBtn" type="button" aria-pressed="false" title="Ovozli yordamchi (Alt+V)">
        <i class="fas fa-microphone" aria-hidden="true"></i> <span>Ovoz</span>
      </button>
      <button id="eduNavGestureBtn" type="button" aria-pressed="false" title="Kamera orqali imo-navigatsiya (Alt+G)">
        <i class="fas fa-hand-pointer" aria-hidden="true"></i> <span>Imo</span>
      </button>
      <span id="eduVoiceStatus">Bosib, ovozli yordamchini yoqing</span>
      <button id="eduVoiceHelpBtn" type="button" aria-expanded="false" aria-controls="eduVoiceHelp" title="Ovoz buyruqlari">?</button>
    `;
    const live = document.createElement('div');
    live.id = 'eduVoiceLive';
    live.className = 'edu-sr-only';
    live.setAttribute('aria-live', 'polite');
    document.body.appendChild(dock);
    document.body.appendChild(live);

    const help = document.createElement('div');
    help.id = 'eduVoiceHelp';
    help.hidden = true;
    help.innerHTML = `
      <strong>Ovozli buyruqlar</strong>
      <ul>
        <li><b>Navigatsiya:</b> “Bosh sahifa”, “Guruhlar”, “Jadval”, “Profil”, “Orqaga”</li>
        <li><b>Tezkor:</b> “Guruhimga kir”, “Darsga qo‘shil”</li>
        <li><b>Chat:</b> “Chatga yoz ...”, “Oxirgi 3 ta xabarni o‘qi”</li>
        <li><b>Sahifa:</b> “Pastga”, “Keyingi tugma”, “Tanla”, “Sahifani o‘qi”</li>
        <li><b>Ko‘rinish:</b> “Tungi mavzuni yoq”, “Kunduzgi mavzuni yoq”</li>
        <li><b>Dars:</b> “Subtitrlarni yoq”, kamera, mikrofon, ekran, davomat, yozuv, to‘liq ekran</li>
        <li><b>Doska:</b> och/yop, qalam, matn, chiziq, doira, to‘rtburchak, strelka, rang, bekor qilish</li>
        <li><b>Kirish imkoniyati:</b> “Navigatsiya imoni yoq”, “AI imoni yoq”</li>
      </ul>
    `;
    document.body.appendChild(help);

    byId('eduVoiceBtn').addEventListener('click', () => setVoiceEnabled(!voiceState.desired));
    byId('eduNavGestureBtn').addEventListener('click', () => {
      setNavigationGesturesEnabled(!navigationGestureState.enabled, true).catch((error) => {
        setVoiceStatus(text(error?.message || error), 'error');
      });
    });
    byId('eduVoiceHelpBtn').addEventListener('click', () => {
      help.hidden = !help.hidden;
      byId('eduVoiceHelpBtn').setAttribute('aria-expanded', help.hidden ? 'false' : 'true');
    });
    document.addEventListener('keydown', (event) => {
      if (event.altKey && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        setVoiceEnabled(!voiceState.desired);
      }
      if (event.altKey && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        setNavigationGesturesEnabled(!navigationGestureState.enabled, true).catch((error) => {
          setVoiceStatus(text(error?.message || error), 'error');
        });
      }
      if (event.key === 'Escape' && !help.hidden) help.hidden = true;
    });
  }

  function addSkipLink() {
    if (byId('eduSkipLink')) return;
    const target = document.querySelector('main') || document.querySelector('[role="main"]');
    if (!target) return;
    if (!target.id) target.id = 'main-content';
    const link = document.createElement('a');
    link.id = 'eduSkipLink';
    link.href = `#${target.id}`;
    link.textContent = 'Asosiy mazmunga o‘tish';
    link.style.cssText = 'position:fixed;left:8px;top:-80px;z-index:2147483647;padding:8px 10px;background:#17477c;color:white;border-radius:2px;transition:top .12s';
    link.addEventListener('focus', () => { link.style.top = '8px'; });
    link.addEventListener('blur', () => { link.style.top = '-80px'; });
    document.body.prepend(link);
  }

  function injectCallButtons() {
    const topBar = byId('groupCallTopBar');
    if (!topBar || byId('btnEduCaptions')) return;
    const desktop = topBar.querySelector('.hidden.sm\\:flex');
    if (desktop) {
      const captions = document.createElement('button');
      captions.id = 'btnEduCaptions';
      captions.className = 'edu-caption-tool';
      captions.type = 'button';
      captions.title = 'Jonli subtitrlar';
      captions.innerHTML = '<i class="fas fa-closed-captioning"></i>';
      captions.addEventListener('click', toggleCaptions);
      const gesture = document.createElement('button');
      gesture.id = 'btnEduGesture';
      gesture.className = 'edu-call-tool';
      gesture.type = 'button';
      gesture.title = 'AI imo-ishora boshqaruvi';
      gesture.innerHTML = '<i class="fas fa-hand-pointer"></i>';
      gesture.addEventListener('click', () => setGestureEnabled(!gestureState.enabled, true));
      const endButton = desktop.querySelector('button[title="End/Leave"]');
      desktop.insertBefore(captions, endButton || null);
      desktop.insertBefore(gesture, endButton || null);
    }
    const mobile = byId('callMoreMenu');
    if (mobile) {
      const captionButton = document.createElement('button');
      captionButton.id = 'mBtnEduCaptions';
      captionButton.type = 'button';
      captionButton.className = 'edu-caption-tool w-full text-left px-4 py-3 flex items-center gap-3';
      captionButton.innerHTML = '<i class="fas fa-closed-captioning w-5 text-center"></i><span>Jonli subtitr</span>';
      captionButton.addEventListener('click', () => { toggleCaptions(); try { closeCallMoreMenu(); } catch (_) {} });
      const gestureButton = document.createElement('button');
      gestureButton.id = 'mBtnEduGesture';
      gestureButton.type = 'button';
      gestureButton.className = 'edu-call-tool w-full text-left px-4 py-3 flex items-center gap-3';
      gestureButton.innerHTML = '<i class="fas fa-hand-pointer w-5 text-center"></i><span>AI imo-ishora</span>';
      gestureButton.addEventListener('click', () => { setGestureEnabled(!gestureState.enabled, true); try { closeCallMoreMenu(); } catch (_) {} });
      mobile.insertBefore(captionButton, mobile.firstChild);
      mobile.insertBefore(gestureButton, captionButton.nextSibling);
    }
    setCaptionsEnabled(captionEnabled(), false);
    syncGestureButtonVisibility();
  }

  function syncGestureButtonVisibility() {
    const role = currentRole();
    if (!role) return;
    const visible = isTeacher();
    document.querySelectorAll('.edu-call-tool').forEach((button) => {
      button.style.display = visible ? '' : 'none';
    });
  }

  function createGestureHud() {
    const host = byId('teacherStageWrap');
    if (!host || byId('eduGestureHud')) return;
    const hud = document.createElement('div');
    hud.id = 'eduGestureHud';
    hud.setAttribute('aria-live', 'polite');
    hud.innerHTML = '<span id="eduGestureDot"></span><span id="eduGestureLabel">AI imo tayyor</span>';
    const cursor = document.createElement('div');
    cursor.id = 'eduGestureCursor';
    host.style.position = 'relative';
    host.appendChild(hud);
    byId('teacherStage')?.appendChild(cursor);
  }

  function setGestureHint(message, mode) {
    gestureState.hint = text(message);
    const label = byId('eduGestureLabel');
    const hud = byId('eduGestureHud');
    if (label) label.textContent = gestureState.hint;
    if (hud) {
      hud.classList.toggle('active', gestureState.enabled || gestureState.loading);
      hud.dataset.mode = text(mode || '');
    }
  }

  function setGestureButtons(active) {
    document.querySelectorAll('.edu-call-tool').forEach((button) => {
      button.classList.toggle('active', !!active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  async function createVisionTask(factory, resolver, modelUrl, kind) {
    const baseOptions = { modelAssetPath: modelUrl, delegate: 'GPU' };
    const taskOptions = kind === 'hand'
      ? {
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.55,
          minTrackingConfidence: 0.5
        }
      : {
          runningMode: 'VIDEO',
          numFaces: 1,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false
        };
    try {
      return await factory.createFromOptions(resolver, {
        baseOptions,
        ...taskOptions
      });
    } catch (_) {
      return factory.createFromOptions(resolver, {
        baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
        ...taskOptions
      });
    }
  }

  async function loadGestureModels() {
    if (gestureState.hand && gestureState.face) return;
    if (gestureState.loading) {
      while (gestureState.loading) await new Promise((resolve) => setTimeout(resolve, 120));
      if (gestureState.hand && gestureState.face) return;
    }
    gestureState.loading = true;
    setGestureHint('AI imo modeli yuklanmoqda…', 'loading');
    try {
      const vision = await import(TASKS_MODULE_URL);
      const resolver = await vision.FilesetResolver.forVisionTasks(TASKS_WASM_URL);
      const [hand, face] = await Promise.all([
        createVisionTask(vision.HandLandmarker, resolver, HAND_MODEL_URL, 'hand'),
        createVisionTask(vision.FaceLandmarker, resolver, FACE_MODEL_URL, 'face')
      ]);
      gestureState.hand = hand;
      gestureState.face = face;
      setGestureHint('AI imo tayyor', 'ready');
    } finally {
      gestureState.loading = false;
    }
  }

  function teacherCameraVideo(preferredUserId) {
    const preferred = text(preferredUserId || '');
    if (preferred) {
      const direct = byId(`vid_${preferred}`);
      if (direct?.readyState >= 2) return direct;
      const tile = Array.from(document.querySelectorAll('[data-uid]')).find((item) => text(item?.dataset?.uid) === preferred);
      const tileVideo = tile?.querySelector?.('video');
      if (tileVideo?.readyState >= 2) return tileVideo;
    }
    const stageVideo = document.querySelector('#teacherStage .stage-slot-primary video, #teacherStage video');
    if (stageVideo?.readyState >= 2) return stageVideo;
    const me = (() => { try { return text(typeof myUserId === 'function' ? myUserId() : currentUser?._id); } catch (_) { return ''; } })();
    const local = me ? byId(`vid_${me}`) : null;
    if (local?.readyState >= 2) return local;
    return document.querySelector('#teacherStage video[muted], #studentsGrid video[muted], video[muted]');
  }

  function pointDistance(a, b) { return Math.hypot(Number(a?.x || 0) - Number(b?.x || 0), Number(a?.y || 0) - Number(b?.y || 0)); }
  function jointAngle(a, b, c) {
    const abx = Number(a?.x || 0) - Number(b?.x || 0);
    const aby = Number(a?.y || 0) - Number(b?.y || 0);
    const cbx = Number(c?.x || 0) - Number(b?.x || 0);
    const cby = Number(c?.y || 0) - Number(b?.y || 0);
    const denominator = Math.max(0.00001, Math.hypot(abx, aby) * Math.hypot(cbx, cby));
    return Math.acos(clamp((abx * cbx + aby * cby) / denominator, -1, 1)) * 180 / Math.PI;
  }
  function fingerExtended(points, mcp, pip, dip, tip) {
    const straight = jointAngle(points[mcp], points[pip], points[dip]) > 145 && jointAngle(points[pip], points[dip], points[tip]) > 140;
    return straight && pointDistance(points[0], points[tip]) > pointDistance(points[0], points[pip]) * 1.08;
  }
  function handGesture(points) {
    if (!Array.isArray(points) || points.length < 21) return { mode: 'none', point: null };
    const extended = [
      fingerExtended(points, 5, 6, 7, 8),
      fingerExtended(points, 9, 10, 11, 12),
      fingerExtended(points, 13, 14, 15, 16),
      fingerExtended(points, 17, 18, 19, 20)
    ];
    const count = extended.filter(Boolean).length;
    const pinch = pointDistance(points[4], points[8]) < 0.055;
    if (pinch) return { mode: 'line', point: points[8], second: points[4], extended };
    if (extended[0] && extended[1] && extended[2] && !extended[3]) return { mode: 'rectangle', point: points[8], extended };
    if (extended[0] && extended[1] && !extended[2] && !extended[3]) return { mode: 'circle', point: points[8], extended };
    if (extended[0] && !extended[1] && !extended[2] && !extended[3]) return { mode: 'point', point: points[8], extended };
    if (count >= 4) return { mode: 'freeze', point: points[9], extended };
    if (count === 0) return { mode: 'fist', point: points[9], extended };
    return { mode: 'none', point: points[9], extended };
  }

  function createNavigationGestureUi() {
    if (byId('eduGestureNavPanel')) return;
    const panel = document.createElement('section');
    panel.id = 'eduGestureNavPanel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Kamera orqali imo-navigatsiya');
    panel.innerHTML = `
      <header>
        <strong>Imo-navigatsiya</strong>
        <button id="eduGestureNavClose" type="button" aria-label="Imo-navigatsiyani yopish">×</button>
      </header>
      <video id="eduGestureNavVideo" autoplay muted playsinline aria-label="Imo-navigatsiya kamera ko‘rinishi"></video>
      <div id="eduGestureNavStatus" role="status">Kamera kutilmoqda…</div>
      <ul>
        <li><b>Ko‘rsatkich:</b> kursor</li>
        <li><b>Chimchilash:</b> tanlash</li>
        <li><b>Kaftni silkiting:</b> tugma/bo‘limlar bo‘ylab yurish</li>
        <li><b>V belgisi:</b> joriy dars</li>
        <li><b>3 barmoq:</b> xabarlar</li>
        <li><b>Musht:</b> orqaga</li>
      </ul>
    `;
    const cursor = document.createElement('div');
    cursor.id = 'eduNavGestureCursor';
    cursor.setAttribute('aria-hidden', 'true');
    document.body.appendChild(panel);
    document.body.appendChild(cursor);
    navigationGestureState.video = byId('eduGestureNavVideo');
    byId('eduGestureNavClose')?.addEventListener('click', () => setNavigationGesturesEnabled(false, true));
  }

  function setNavigationGestureStatus(message, mode) {
    const status = byId('eduGestureNavStatus');
    const panel = byId('eduGestureNavPanel');
    if (status) status.textContent = text(message);
    if (panel) panel.dataset.mode = text(mode || '');
  }

  function clearNavigationGestureTarget() {
    navigationGestureState.target?.classList?.remove('edu-gesture-target');
    navigationGestureState.target = null;
  }

  function navigationTargetAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    const target = hit?.closest?.('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[role="button"]');
    if (!target || target.closest('#eduGestureNavPanel') || target.offsetParent === null) return null;
    return target;
  }

  function gestureNavigationTargets() {
    const selector = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[role="button"],[data-gesture-target],main section,main article,main [role="region"],main .card,main .panel';
    return Array.from(document.querySelectorAll(selector)).filter((item, index, all) => {
      if (!item || item.closest('#eduGestureNavPanel,#eduVoiceDock,#eduVoiceHelp') || item.getAttribute('aria-hidden') === 'true') return false;
      const rect = item.getBoundingClientRect?.();
      if (!rect || rect.width < 8 || rect.height < 8) return false;
      return all.indexOf(item) === index;
    });
  }

  function cycleGestureTarget(direction) {
    const targets = gestureNavigationTargets();
    if (!targets.length) return setNavigationGestureStatus('Tanlanadigan bo‘lim topilmadi', 'error');
    const current = targets.indexOf(navigationGestureState.target);
    const delta = direction === 'previous' ? -1 : 1;
    const index = current < 0 ? 0 : (current + delta + targets.length) % targets.length;
    clearNavigationGestureTarget();
    const target = targets[index];
    navigationGestureState.focusIndex = index;
    navigationGestureState.target = target;
    target.classList.add('edu-gesture-target');
    if (!target.matches('a,button,input,select,textarea,[tabindex]')) target.setAttribute('tabindex', '-1');
    target.focus?.({ preventScroll: true });
    target.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    const label = text(target.getAttribute('aria-label') || target.title || target.querySelector('h1,h2,h3,strong')?.textContent || target.innerText || 'Bo‘lim').trim().slice(0, 80);
    setNavigationGestureStatus(`${index + 1}/${targets.length}: ${label || 'Bo‘lim'}`, 'wave');
  }

  function updateNavigationCursor(point) {
    if (!point) return null;
    const x = clamp(1 - Number(point.x || 0), 0, 1) * window.innerWidth;
    const y = clamp(Number(point.y || 0), 0, 1) * window.innerHeight;
    const cursor = byId('eduNavGestureCursor');
    if (cursor) {
      cursor.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
      cursor.classList.add('active');
    }
    const target = navigationTargetAt(x, y);
    if (target !== navigationGestureState.target) {
      clearNavigationGestureTarget();
      navigationGestureState.target = target;
      target?.classList?.add('edu-gesture-target');
    }
    return target;
  }

  async function runNavigationGestureAction(action, label) {
    const now = Date.now();
    if (navigationGestureState.busy || now - navigationGestureState.lastActionAt < 1400) return;
    navigationGestureState.busy = true;
    navigationGestureState.lastActionAt = now;
    setNavigationGestureStatus(label, 'action');
    try {
      if (action === 'select') {
        const target = navigationGestureState.target;
        if (!target) throw new Error('Tanlanadigan tugma topilmadi');
        target.focus?.({ preventScroll: true });
        target.click();
      } else if (action === 'group') {
        await openMyGroup();
      } else if (action === 'lesson') {
        await joinCurrentLesson();
      } else if (action === 'messages') {
        navigateTo('/messages.html', 'Xabarlar');
      } else if (action === 'back') {
        history.back();
      }
    } catch (error) {
      setNavigationGestureStatus(text(error?.message || error), 'error');
      await speak(text(error?.message || error));
    } finally {
      navigationGestureState.busy = false;
    }
  }

  function processNavigationGesture(handResult) {
    const gesture = handGesture(handResult?.landmarks?.[0]);
    const now = Date.now();
    if (gesture.mode !== navigationGestureState.lastMode) {
      navigationGestureState.lastMode = gesture.mode;
      navigationGestureState.modeSince = now;
    }
    const stableMs = now - navigationGestureState.modeSince;
    if (gesture.point) updateNavigationCursor(gesture.point);
    if (gesture.mode === 'freeze' && gesture.point) {
      const anchor = navigationGestureState.waveAnchor;
      if (!anchor || now - anchor.at > 850) {
        navigationGestureState.waveAnchor = { x: Number(gesture.point.x || 0), at: now };
      } else {
        const dx = Number(gesture.point.x || 0) - Number(anchor.x || 0);
        if (Math.abs(dx) >= .14 && now - navigationGestureState.lastWaveAt > 520) {
          navigationGestureState.lastWaveAt = now;
          navigationGestureState.waveAnchor = { x: Number(gesture.point.x || 0), at: now };
          cycleGestureTarget(dx > 0 ? 'previous' : 'next');
          return;
        }
      }
      setNavigationGestureStatus('Kaftni chap/o‘ng silkiting — elementlar almashadi', 'wave');
      return;
    }
    if (gesture.mode !== 'freeze') navigationGestureState.waveAnchor = null;
    if (gesture.mode === 'point') {
      setNavigationGestureStatus(navigationGestureState.target ? 'Tugma ustida — chimchilab tanlang' : 'Ko‘rsatkich bilan kursorni yuring', 'point');
    } else if (gesture.mode === 'line' && stableMs > 280) {
      runNavigationGestureAction('select', 'Tanlanmoqda…');
    } else if (gesture.mode === 'circle' && stableMs > 900) {
      runNavigationGestureAction('lesson', 'Faol dars qidirilmoqda…');
    } else if (gesture.mode === 'rectangle' && stableMs > 900) {
      runNavigationGestureAction('messages', 'Xabarlar ochilmoqda…');
    } else if (gesture.mode === 'fist' && stableMs > 1000) {
      runNavigationGestureAction('back', 'Oldingi sahifaga qaytilmoqda…');
    } else if (gesture.mode === 'none') {
      setNavigationGestureStatus('Qo‘lingizni kamera oldida tuting', 'idle');
    }
  }

  function navigationGestureLoop(timestamp) {
    if (!navigationGestureState.enabled) return;
    navigationGestureState.rafId = requestAnimationFrame(navigationGestureLoop);
    if (timestamp - navigationGestureState.lastDetectAt < 110) return;
    const video = navigationGestureState.video;
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    navigationGestureState.lastDetectAt = timestamp;
    try {
      processNavigationGesture(gestureState.hand?.detectForVideo(video, timestamp) || null);
    } catch (error) {
      setNavigationGestureStatus(`Model xatosi: ${text(error?.message || 'aniqlanmadi')}`, 'error');
    }
  }

  async function setNavigationGesturesEnabled(enabled, announceChange) {
    const next = !!enabled;
    createNavigationGestureUi();
    if (!next) {
      navigationGestureState.enabled = false;
      cancelAnimationFrame(navigationGestureState.rafId);
      navigationGestureState.rafId = 0;
      navigationGestureState.stream?.getTracks?.().forEach((track) => track.stop());
      navigationGestureState.stream = null;
      navigationGestureState.waveAnchor = null;
      navigationGestureState.focusIndex = -1;
      if (navigationGestureState.video) navigationGestureState.video.srcObject = null;
      clearNavigationGestureTarget();
      byId('eduNavGestureCursor')?.classList.remove('active');
      if (byId('eduGestureNavPanel')) byId('eduGestureNavPanel').hidden = true;
      byId('eduNavGestureBtn')?.setAttribute('aria-pressed', 'false');
      localStorage.setItem(NAV_GESTURE_ENABLED_KEY, '0');
      if (announceChange) await speak('Kamera orqali imo-navigatsiya o‘chirildi');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Bu brauzer kamerani qo‘llamaydi');
    if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(location.hostname)) {
      throw new Error('Kamera uchun sayt HTTPS orqali ochilishi kerak');
    }
    if (gestureState.enabled) await setGestureEnabled(false, false);
    let stream;
    try {
      const existingVideo = document.querySelector('#teacherStage video[muted], #studentsGrid video[muted], video[muted]');
      const existingTrack = existingVideo?.srcObject?.getVideoTracks?.().find((track) => track?.readyState === 'live') || null;
      if (existingTrack?.clone) {
        stream = new MediaStream([existingTrack.clone()]);
        navigationGestureState.borrowedCamera = true;
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { width: { ideal: 640 }, height: { ideal: 360 }, aspectRatio: { ideal: 16 / 9 }, facingMode: 'user' }
        });
        navigationGestureState.borrowedCamera = false;
      }
      await loadGestureModels();
    } catch (error) {
      stream?.getTracks?.().forEach((track) => track.stop());
      const name = text(error?.name);
      if (name === 'NotAllowedError') throw new Error('Kameraga ruxsat berilmadi');
      if (name === 'NotFoundError') throw new Error('Kamera topilmadi');
      throw new Error(`Imo-navigatsiya ishga tushmadi: ${text(error?.message || error)}`);
    }
    navigationGestureState.stream = stream;
    navigationGestureState.enabled = true;
    navigationGestureState.lastDetectAt = 0;
    navigationGestureState.lastMode = '';
    navigationGestureState.modeSince = 0;
    navigationGestureState.waveAnchor = null;
    navigationGestureState.lastWaveAt = 0;
    navigationGestureState.focusIndex = -1;
    navigationGestureState.video = byId('eduGestureNavVideo');
    navigationGestureState.video.srcObject = stream;
    await navigationGestureState.video.play().catch(() => {});
    byId('eduGestureNavPanel').hidden = false;
    byId('eduNavGestureBtn')?.setAttribute('aria-pressed', 'true');
    localStorage.setItem(NAV_GESTURE_ENABLED_KEY, '1');
    setNavigationGestureStatus('Qo‘lingizni kamera oldida tuting', 'ready');
    cancelAnimationFrame(navigationGestureState.rafId);
    navigationGestureState.rafId = requestAnimationFrame(navigationGestureLoop);
    if (announceChange) await speak('Kamera orqali imo-navigatsiya yoqildi');
  }

  function faceFocus(result) {
    const points = result?.faceLandmarks?.[0];
    if (!Array.isArray(points) || !points.length) return null;
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    points.forEach((point) => {
      minX = Math.min(minX, Number(point.x || 0));
      maxX = Math.max(maxX, Number(point.x || 0));
      minY = Math.min(minY, Number(point.y || 0));
      maxY = Math.max(maxY, Number(point.y || 0));
    });
    const width = Math.max(.08, maxX - minX);
    return {
      anchorX: clamp((minX + maxX) / 2, 0, 1),
      anchorY: clamp((minY + maxY) / 2 - .03, 0, 1),
      scale: clamp(.6 / width, 1.25, 2.05)
    };
  }

  function applyStageFocus(payload) {
    try {
      const viewport = typeof getTeacherStageViewportEl === 'function' ? getTeacherStageViewportEl() : byId('teacherStageViewport');
      if (!viewport) return;
      let pip = byId('eduFaceFocusPip');
      if (!pip) {
        pip = document.createElement('div');
        pip.id = 'eduFaceFocusPip';
        pip.dataset.mode = 'reset';
        pip.innerHTML = '<canvas width="480" height="270" aria-label="AI yuz va ko‘rsatkich fokusi"></canvas><span>AI FOKUS</span>';
        viewport.appendChild(pip);
      } else if (pip.parentElement !== viewport) {
        viewport.appendChild(pip);
      }
      const video = teacherCameraVideo(payload?.byUserId);
      const canvas = pip.querySelector('canvas');
      const ctx = canvas?.getContext?.('2d', { alpha: false });
      const mode = text(payload?.mode || 'face');
      pip.dataset.mode = mode;
      if (!video || video.readyState < 2 || !video.videoWidth || !ctx) return;
      const scale = clamp(payload?.scale || 1.65, 1.15, 4);
      const anchorX = clamp(payload?.anchorX ?? .5, 0, 1);
      const anchorY = clamp(payload?.anchorY ?? .5, 0, 1);
      gestureState.focusRender = gestureState.focusRender || { x: anchorX, y: anchorY, scale };
      const smoothing = mode === 'point' ? .44 : .22;
      gestureState.focusRender.x += (anchorX - gestureState.focusRender.x) * smoothing;
      gestureState.focusRender.y += (anchorY - gestureState.focusRender.y) * smoothing;
      gestureState.focusRender.scale += (scale - gestureState.focusRender.scale) * smoothing;
      const sourceW = video.videoWidth;
      const sourceH = video.videoHeight;
      let cropW = sourceW / gestureState.focusRender.scale;
      let cropH = cropW * 9 / 16;
      if (cropH > sourceH) {
        cropH = sourceH / gestureState.focusRender.scale;
        cropW = cropH * 16 / 9;
      }
      const sx = clamp(gestureState.focusRender.x * sourceW - cropW / 2, 0, Math.max(0, sourceW - cropW));
      const sy = clamp(gestureState.focusRender.y * sourceH - cropH / 2, 0, Math.max(0, sourceH - cropH));
      ctx.fillStyle = '#020609';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height);
      const label = pip.querySelector('span');
      if (label) label.textContent = mode === 'point' ? 'KO‘RSATILGAN JOY' : mode === 'freeze' ? 'FOKUS QOTIRILDI' : 'YUZ FOKUSI';
      const cursor = byId('eduGestureCursor');
      if (cursor) {
        cursor.style.left = `${anchorX * 100}%`;
        cursor.style.top = `${anchorY * 100}%`;
        cursor.classList.toggle('active', mode === 'point');
      }
    } catch (_) {}
  }

  function emitStageFocus(payload) {
    const now = Date.now();
    applyStageFocus(payload);
    if (now - gestureState.lastEmitAt < 100) return;
    gestureState.lastEmitAt = now;
    try {
      if (typeof socket === 'undefined' || !socket || typeof groupCall === 'undefined' || !groupCall?.active) return;
      socket.emit('groupStageGesture', {
        groupId: groupCall.groupId,
        callId: groupCall.callId,
        mode: payload.mode,
        scale: payload.scale,
        anchorX: payload.anchorX,
        anchorY: payload.anchorY
      });
    } catch (_) {}
  }

  function drawWhiteboardFreehand(point) {
    try {
      if (typeof stageWhiteboard === 'undefined' || !stageWhiteboard?.active || !stageWhiteboard?.inkCtx || !stageWhiteboard?.inkCanvas) return;
      const x = clamp(point?.x, 0, 1) * stageWhiteboard.inkCanvas.width;
      const y = clamp(point?.y, 0, 1) * stageWhiteboard.inkCanvas.height;
      const ctx = stageWhiteboard.inkCtx;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = text(stageWhiteboard.color || '#1d5fa8');
      ctx.lineWidth = Math.max(3, Number(stageWhiteboard.size || 4));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const previous = gestureState.lastDrawPoint || { x, y };
      if (gestureState.lastDrawPoint) ctx.moveTo(gestureState.lastDrawPoint.x, gestureState.lastDrawPoint.y);
      else ctx.moveTo(x, y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.restore();
      try {
        if (typeof emitStageWhiteboardStroke === 'function') emitStageWhiteboardStroke(previous, { x, y }, { color: stageWhiteboard.color, size: stageWhiteboard.size });
      } catch (_) {}
      gestureState.lastDrawPoint = { x, y };
      if (typeof renderStageWhiteboardFrame === 'function') renderStageWhiteboardFrame();
    } catch (_) {}
  }

  function drawWhiteboardShape(mode, point, second) {
    const now = Date.now();
    if (now - gestureState.lastShapeAt < 1100) return;
    try {
      if (typeof stageWhiteboard === 'undefined' || !stageWhiteboard?.active || !stageWhiteboard?.inkCtx || !stageWhiteboard?.inkCanvas) return;
      gestureState.lastShapeAt = now;
      const canvas = stageWhiteboard.inkCanvas;
      const ctx = stageWhiteboard.inkCtx;
      const x = clamp(point?.x, .1, .9) * canvas.width;
      const y = clamp(point?.y, .12, .88) * canvas.height;
      const size = Math.max(55, Math.min(canvas.width, canvas.height) * .12);
      if (Array.isArray(stageWhiteboard.shapeObjects)) {
        try { if (typeof pushStageWhiteboardHistory === 'function') pushStageWhiteboardHistory(); } catch (_) {}
        const lineX = second ? clamp(second.x, 0, 1) * canvas.width : x + size;
        const lineY = second ? clamp(second.y, 0, 1) * canvas.height : y + size * .12;
        const object = {
          id: `wb_shape_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          tool: mode === 'line' ? 'line' : mode,
          x: mode === 'line' ? ((x + lineX) / 2) / canvas.width : x / canvas.width,
          y: mode === 'line' ? ((y + lineY) / 2) / canvas.height : y / canvas.height,
          width: mode === 'line' ? Math.max(.04, Math.abs(x - lineX) / canvas.width) : Math.max(.06, size * 1.44 / canvas.width),
          height: mode === 'line' ? Math.max(.035, Math.abs(y - lineY) / canvas.height) : Math.max(.06, size * .96 / canvas.height),
          rotation: 0,
          color: text(stageWhiteboard.color || '#1d5fa8'),
          size: Math.max(3, Number(stageWhiteboard.size || 4)),
          fill: 'transparent'
        };
        stageWhiteboard.shapeObjects.push(object);
        stageWhiteboard.selectedShapeId = object.id;
        stageWhiteboard.selectedTextId = '';
        if (typeof renderStageWhiteboardFrame === 'function') renderStageWhiteboardFrame();
        setGestureHint(mode === 'circle' ? 'Doira chizildi' : mode === 'rectangle' ? 'To‘rtburchak chizildi' : 'Chiziq chizildi', mode);
        return;
      }
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = text(stageWhiteboard.color || '#1d5fa8');
      ctx.lineWidth = Math.max(3, Number(stageWhiteboard.size || 4));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (mode === 'circle') {
        ctx.arc(x, y, size * .54, 0, Math.PI * 2);
      } else if (mode === 'rectangle') {
        ctx.rect(x - size * .72, y - size * .48, size * 1.44, size * .96);
      } else {
        const x2 = second ? clamp(second.x, 0, 1) * canvas.width : x + size;
        const y2 = second ? clamp(second.y, 0, 1) * canvas.height : y;
        const dx = x - x2;
        const dy = y - y2;
        const length = Math.max(1, Math.hypot(dx, dy));
        ctx.moveTo(x - (dx / length) * size, y - (dy / length) * size);
        ctx.lineTo(x + (dx / length) * size, y + (dy / length) * size);
      }
      ctx.stroke();
      ctx.restore();
      if (typeof renderStageWhiteboardFrame === 'function') renderStageWhiteboardFrame();
      setGestureHint(mode === 'circle' ? 'Doira chizildi' : mode === 'rectangle' ? 'To‘rtburchak chizildi' : 'Chiziq chizildi', mode);
    } catch (_) {}
  }

  function processGesture(handResult, faceResult) {
    const points = handResult?.landmarks?.[0];
    const gesture = handGesture(points);
    const now = Date.now();
    if (gesture.mode !== gestureState.lastMode) {
      gestureState.lastMode = gesture.mode;
      gestureState.modeSince = now;
      gestureState.lastDrawPoint = null;
      if (gesture.mode !== 'fist') gestureState.fistStartAngle = null;
    }
    const stableMs = now - gestureState.modeSince;

    let whiteboardActive = false;
    try { whiteboardActive = !!(typeof stageWhiteboard !== 'undefined' && stageWhiteboard?.active); } catch (_) {}
    if (whiteboardActive && gesture.point) {
      if (gesture.mode === 'point' && stableMs > 180) {
        drawWhiteboardFreehand(gesture.point);
        setGestureHint('Ko‘rsatkich bilan chizilmoqda', 'point');
        return;
      }
      if (['circle', 'rectangle', 'line'].includes(gesture.mode) && stableMs > 650) {
        drawWhiteboardShape(gesture.mode, gesture.point, gesture.second);
        return;
      }
    }

    if (gesture.mode === 'point' && gesture.point && stableMs > 160) {
      // Follow the finger while visible, then hold the last shown location.
      gestureState.frozen = true;
      const payload = { mode: 'point', scale: 2.55, anchorX: gesture.point.x, anchorY: gesture.point.y };
      emitStageFocus(payload);
      setGestureHint('Ko‘rsatilgan joy yaqinlashtirildi', 'point');
      return;
    }

    if (gesture.mode === 'freeze' && stableMs > 240) {
      gestureState.frozen = true;
      byId('eduGestureCursor')?.classList.remove('active');
      setGestureHint('STOP — fokus qotirildi', 'freeze');
      return;
    }

    if (gesture.mode === 'fist' && Array.isArray(points) && stableMs > 420) {
      setGestureHint('Musht — fokus bo‘shatiladi', 'fist');
      if (gestureState.frozen) {
        gestureState.frozen = false;
        emitStageFocus({ mode: 'reset', scale: 1, anchorX: .5, anchorY: .5 });
        setGestureHint('Yuz kuzatuviga qaytildi', 'reset');
      }
      return;
    }

    if (!gestureState.frozen) {
      const face = faceFocus(faceResult);
      if (face) {
        emitStageFocus({ mode: 'face', scale: face.scale, anchorX: face.anchorX, anchorY: face.anchorY });
        setGestureHint('Yuz avtomatik fokusda', 'face');
      } else {
        setGestureHint('Qo‘l yoki yuz kutilmoqda', 'idle');
      }
    }
  }

  function gestureLoop(timestamp) {
    if (!gestureState.enabled) return;
    gestureState.rafId = requestAnimationFrame(gestureLoop);
    if (timestamp - gestureState.lastDetectAt < 105) return;
    const video = teacherCameraVideo(typeof myUserId === 'function' ? myUserId() : '');
    if (!video || video.readyState < 2 || !video.videoWidth) {
      setGestureHint('O‘qituvchi kamerasi kutilmoqda', 'waiting');
      return;
    }
    gestureState.lastDetectAt = timestamp;
    try {
      const handResult = gestureState.hand?.detectForVideo(video, timestamp) || null;
      const faceResult = gestureState.face?.detectForVideo(video, timestamp) || null;
      processGesture(handResult, faceResult);
    } catch (error) {
      setGestureHint(`AI imo xatosi: ${text(error?.message || 'model')}`, 'error');
    }
  }

  async function setGestureEnabled(enabled, announceChange) {
    const next = !!enabled;
    if (next && !isGroupPage()) throw new Error('AI imo faqat videodars sahifasida ishlaydi');
    if (next && !isTeacher()) throw new Error('AI imo boshqaruvi faqat o‘qituvchi uchun');
    if (next && navigationGestureState.enabled) await setNavigationGesturesEnabled(false, false);
    if (next) {
      try {
        await loadGestureModels();
      } catch (error) {
        gestureState.enabled = false;
        setGestureButtons(false);
        setGestureHint('AI model yuklanmadi. Internetni tekshiring.', 'error');
        if (announceChange) speak('AI imo modeli yuklanmadi. Internetni tekshiring.');
        return;
      }
    }
    gestureState.enabled = next;
    localStorage.setItem(GESTURE_ENABLED_KEY, next ? '1' : '0');
    setGestureButtons(next);
    if (next) {
      // AI focus is rendered in its own PiP; keep the primary camera full-frame.
      try { if (typeof resetTeacherStageZoom === 'function') resetTeacherStageZoom(); } catch (_) {}
      cancelAnimationFrame(gestureState.rafId);
      gestureState.lastDetectAt = 0;
      gestureState.rafId = requestAnimationFrame(gestureLoop);
      setGestureHint('AI imo faol', 'ready');
    } else {
      cancelAnimationFrame(gestureState.rafId);
      gestureState.rafId = 0;
      gestureState.frozen = false;
      gestureState.lastDrawPoint = null;
      byId('eduGestureHud')?.classList.remove('active');
      byId('eduGestureCursor')?.classList.remove('active');
      try { emitStageFocus({ mode: 'reset', scale: 1, anchorX: .5, anchorY: .5 }); } catch (_) {}
    }
    if (announceChange) speak(next ? 'AI imo boshqaruvi yoqildi' : 'AI imo boshqaruvi o‘chirildi');
  }

  function bindRemoteGestureSignal() {
    if (gestureState.remoteBound) return;
    try {
      if (typeof socket === 'undefined' || !socket?.on) return;
      gestureState.remoteBound = true;
      socket.on('groupStageGesture', (payload) => {
        try {
          if (typeof groupCall === 'undefined' || !groupCall?.active) return;
          if (text(payload?.groupId) !== text(groupCall.groupId) || text(payload?.callId) !== text(groupCall.callId)) return;
          if (payload?.mode === 'freeze') return;
          applyStageFocus(payload);
          const labels = {
            point: 'O‘qituvchi ko‘rsatgan joy',
            face: 'O‘qituvchi yuzi fokusda',
            reset: 'To‘liq kadr',
            circle: 'Doira',
            rectangle: 'To‘rtburchak',
            line: 'Chiziq'
          };
          setGestureHint(labels[payload?.mode] || 'AI fokus', payload?.mode);
        } catch (_) {}
      });
    } catch (_) {}
  }

  function restorePendingVoiceMessage() {
    if (!isGroupPage()) return;
    const pending = sessionStorage.getItem('hallaym:pending-voice-message');
    if (!pending) return;
    sessionStorage.removeItem('hallaym:pending-voice-message');
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      if (byId('messageInput') && typeof sendGroupMessage === 'function') {
        clearInterval(timer);
        try { await sendVoiceChat(pending); } catch (error) { speak(text(error?.message || error)); }
      } else if (attempts > 20) {
        clearInterval(timer);
        speak('Chat tayyor bo‘lmadi');
      }
    }, 350);
  }

  function initGroupEnhancements() {
    if (!isGroupPage()) return;
    currentGroupId();
    injectCallButtons();
    createGestureHud();
    bindRemoteGestureSignal();
    restorePendingVoiceMessage();
    const bindTimer = setInterval(() => {
      injectCallButtons();
      createGestureHud();
      bindRemoteGestureSignal();
      syncGestureButtonVisibility();
      if (gestureState.remoteBound) clearInterval(bindTimer);
    }, 500);
    setTimeout(() => clearInterval(bindTimer), 20000);
  }

  function init() {
    document.documentElement.dataset.eduCaptions = captionEnabled() ? 'on' : 'off';
    createVoiceUi();
    createNavigationGestureUi();
    addSkipLink();
    initGroupEnhancements();
    if (localStorage.getItem(VOICE_ENABLED_KEY) === '1') {
      setVoiceStatus('Ovozli yordamchini davom ettirish uchun Ovoz tugmasini bosing', 'idle');
    }
    if (localStorage.getItem(NAV_GESTURE_ENABLED_KEY) === '1') {
      setNavigationGestureStatus('Davom ettirish uchun Imo tugmasini bosing', 'idle');
    }
    window.HallaymAccessibility = {
      speak,
      handleVoiceCommand,
      setVoiceEnabled,
      setCaptionsEnabled,
      setGestureEnabled,
      setNavigationGesturesEnabled,
      readRecentMessages,
      joinCurrentLesson,
      openMyGroup
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
