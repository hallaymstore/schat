(function () {
  'use strict';

  if (window.__hallaymFaceAuthInstalled) return;
  window.__hallaymFaceAuthInstalled = true;

  const originalFetch = window.fetch.bind(window);
  const TASKS_VERSION = '0.10.22-rc.20250304';
  const TASKS_MODULE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/+esm`;
  const TASKS_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
  const FACE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  const STABLE_POINTS = Object.freeze([
    10, 152, 234, 454, 33, 133, 362, 263,
    1, 4, 168, 6, 197, 195, 5, 98,
    327, 205, 425, 50, 280, 101, 330, 70,
    300, 105, 334, 107, 336, 54, 284, 356
  ]);
  const CHALLENGE_COPY = Object.freeze({
    blink: { title: 'Ikki ko‘zingizni bir marta yumib oching', short: 'ko‘zni yumib oching' },
    smile: { title: 'Tabassum qiling va bir soniya ushlab turing', short: 'tabassum qiling' },
    turn: { title: 'Boshingizni yon tomonga burib, yana markazga qarang', short: 'boshingizni yon tomonga buring' }
  });

  let faceModelPromise = null;
  let authFlowPromise = null;
  let activeCapture = null;

  function text(value) { return String(value == null ? '' : value); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }
  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  function ensureSecureCameraContext() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Bu brauzer kamerani qo‘llamaydi. Chrome yoki Edge yangilang.');
    if (!window.isSecureContext && !['localhost', '127.0.0.1'].includes(location.hostname)) {
      throw new Error('Yuz tasdiqlash uchun sayt HTTPS orqali ochilishi kerak.');
    }
  }

  async function loadFaceModel() {
    if (faceModelPromise) return faceModelPromise;
    faceModelPromise = (async () => {
      const vision = await import(TASKS_MODULE_URL);
      const resolver = await vision.FilesetResolver.forVisionTasks(TASKS_WASM_URL);
      const options = {
        baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 2,
        minFaceDetectionConfidence: 0.62,
        minFacePresenceConfidence: 0.62,
        minTrackingConfidence: 0.58,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false
      };
      try {
        return await vision.FaceLandmarker.createFromOptions(resolver, options);
      } catch (_) {
        options.baseOptions.delegate = 'CPU';
        return vision.FaceLandmarker.createFromOptions(resolver, options);
      }
    })().catch((error) => {
      faceModelPromise = null;
      throw error;
    });
    return faceModelPromise;
  }

  function ensureModal() {
    let root = document.getElementById('hallaymFaceAuth');
    if (root) return root;
    root = document.createElement('section');
    root.id = 'hallaymFaceAuth';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'hallaymFaceTitle');
    root.innerHTML = `
      <div class="face-auth-card">
        <header class="face-auth-head">
          <div><h2 id="hallaymFaceTitle" class="face-auth-title">Yuz orqali xavfsiz kirish</h2><p id="hallaymFaceSubtitle" class="face-auth-subtitle">Kamera faqat tasdiqlash vaqtida ishlaydi.</p></div>
          <span aria-label="Xavfsizlik">🔐</span>
        </header>
        <div class="face-auth-body">
          <div id="hallaymFaceCamera" class="face-auth-camera" data-quality="waiting">
            <video id="hallaymFaceVideo" autoplay muted playsinline></video>
            <div class="face-auth-frame" aria-hidden="true"></div>
          </div>
          <aside class="face-auth-side">
            <div class="face-auth-step"><strong>1. Markazga qarang</strong>Yuz oval ichida to‘liq, yorug‘ va bitta bo‘lsin.</div>
            <div class="face-auth-step"><strong>2. Jonlilik harakati</strong><span id="hallaymFaceAction">Topshiriq kutilmoqda…</span></div>
            <div id="hallaymFaceStatus" class="face-auth-status" role="status" aria-live="polite">Boshlash tugmasini bosing.</div>
            <div class="face-auth-progress" aria-hidden="true"><span id="hallaymFaceProgress"></span></div>
            <label id="hallaymFaceConsentWrap" class="face-auth-consent">
              <input id="hallaymFaceConsent" type="checkbox" />
              <span>Yuzimning xom rasmi emas, shifrlangan biometrik shabloni akkaunt xavfsizligi uchun saqlanishiga roziman.</span>
            </label>
            <div class="face-auth-privacy">Tasvir serverda rasm sifatida saqlanmaydi. Kameradagi oqim tekshiruv tugashi bilan yopiladi.</div>
          </aside>
        </div>
        <footer class="face-auth-foot">
          <button id="hallaymFaceCancel" type="button" class="face-auth-button face-auth-cancel">Bekor qilish</button>
          <button id="hallaymFaceStart" type="button" class="face-auth-button">Kamerani ochib tekshirish</button>
        </footer>
      </div>`;
    document.body.appendChild(root);
    return root;
  }

  function setStatus(message, mode) {
    const el = document.getElementById('hallaymFaceStatus');
    if (!el) return;
    el.textContent = message;
    el.dataset.mode = mode || '';
  }

  function setProgress(value) {
    const el = document.getElementById('hallaymFaceProgress');
    if (el) el.style.width = `${clamp(value, 0, 1) * 100}%`;
  }

  function categoryScore(result, name) {
    const categories = result?.faceBlendshapes?.[0]?.categories || [];
    const hit = categories.find((item) => item?.categoryName === name || item?.displayName === name);
    return Number(hit?.score || 0);
  }

  function faceBounds(points) {
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    points.forEach((point) => {
      minX = Math.min(minX, Number(point.x || 0));
      minY = Math.min(minY, Number(point.y || 0));
      maxX = Math.max(maxX, Number(point.x || 0));
      maxY = Math.max(maxY, Number(point.y || 0));
    });
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
  }

  function averagePoint(points, indices) {
    const out = indices.reduce((acc, index) => {
      const point = points[index] || {};
      acc.x += Number(point.x || 0);
      acc.y += Number(point.y || 0);
      acc.z += Number(point.z || 0);
      return acc;
    }, { x: 0, y: 0, z: 0 });
    const length = Math.max(1, indices.length);
    return { x: out.x / length, y: out.y / length, z: out.z / length };
  }

  function qualityOfFace(points) {
    const bounds = faceBounds(points);
    const leftEye = averagePoint(points, [33, 133]);
    const rightEye = averagePoint(points, [362, 263]);
    const eyeDistance = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
    const sizeScore = clamp(1 - Math.abs(bounds.width - .4) / .3, 0, 1);
    const centerScore = clamp(1 - Math.hypot(bounds.centerX - .5, bounds.centerY - .48) / .38, 0, 1);
    const eyeScore = clamp((eyeDistance - .075) / .08, 0, 1);
    const qualityScore = sizeScore * .42 + centerScore * .36 + eyeScore * .22;
    return { bounds, leftEye, rightEye, eyeDistance, qualityScore };
  }

  function landmarkDescriptor(points, quality) {
    const { leftEye, rightEye, eyeDistance } = quality;
    const mid = {
      x: (leftEye.x + rightEye.x) / 2,
      y: (leftEye.y + rightEye.y) / 2,
      z: (leftEye.z + rightEye.z) / 2
    };
    const angle = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const scale = Math.max(.055, eyeDistance);
    const out = [];
    STABLE_POINTS.forEach((index) => {
      const point = points[index] || mid;
      const dx = Number(point.x || 0) - mid.x;
      const dy = Number(point.y || 0) - mid.y;
      const dz = Number(point.z || 0) - mid.z;
      out.push(
        clamp((dx * cosine + dy * sine) / scale, -4, 4),
        clamp((-dx * sine + dy * cosine) / scale, -4, 4),
        clamp(dz / scale, -4, 4)
      );
    });
    return out;
  }

  function textureDescriptor(video, bounds) {
    const canvas = textureDescriptor.canvas || (textureDescriptor.canvas = document.createElement('canvas'));
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const vw = Number(video.videoWidth || 0);
    const vh = Number(video.videoHeight || 0);
    if (!ctx || !vw || !vh) return Array(64).fill(0);
    const centerX = bounds.centerX * vw;
    const centerY = bounds.centerY * vh;
    const cropW = Math.min(vw, Math.max(64, bounds.width * vw * 1.22));
    const cropH = Math.min(vh, Math.max(64, bounds.height * vh * 1.18));
    const sx = clamp(centerX - cropW / 2, 0, Math.max(0, vw - cropW));
    const sy = clamp(centerY - cropH / 2, 0, Math.max(0, vh - cropH));
    ctx.clearRect(0, 0, 8, 8);
    ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, 8, 8);
    const pixels = ctx.getImageData(0, 0, 8, 8).data;
    const values = [];
    for (let index = 0; index < pixels.length; index += 4) {
      values.push((pixels[index] * .299 + pixels[index + 1] * .587 + pixels[index + 2] * .114) / 255);
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const deviation = Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length) || 1;
    const normalized = values.map((value) => (value - mean) / deviation);
    const length = Math.sqrt(normalized.reduce((sum, value) => sum + value * value, 0)) || 1;
    return normalized.map((value) => value / length);
  }

  function frameDescriptor(video, points, quality) {
    return landmarkDescriptor(points, quality).concat(textureDescriptor(video, quality.bounds));
  }

  function averageDescriptors(samples) {
    if (!samples.length) throw new Error('Yuz shabloni olinmadi');
    const values = Array(samples[0].length).fill(0);
    samples.forEach((sample) => sample.forEach((value, index) => { values[index] += Number(value || 0); }));
    values.forEach((_, index) => { values[index] /= samples.length; });
    const textureStart = 96;
    const textureLength = Math.sqrt(values.slice(textureStart).reduce((sum, value) => sum + value * value, 0)) || 1;
    for (let index = textureStart; index < values.length; index += 1) values[index] /= textureLength;
    return values.map((value) => Number(value.toFixed(6)));
  }

  function actionMeasurement(result, points, quality, challenge) {
    if (challenge === 'blink') {
      return (categoryScore(result, 'eyeBlinkLeft') + categoryScore(result, 'eyeBlinkRight')) / 2;
    }
    if (challenge === 'smile') {
      return (categoryScore(result, 'mouthSmileLeft') + categoryScore(result, 'mouthSmileRight')) / 2;
    }
    const nose = points[1] || points[4] || { x: .5 };
    const eyeMidX = (quality.leftEye.x + quality.rightEye.x) / 2;
    return (Number(nose.x || 0) - eyeMidX) / Math.max(.055, quality.eyeDistance);
  }

  function challengePassed(challenge, current, baseline) {
    if (challenge === 'turn') return Math.abs(current - baseline) >= .2;
    if (challenge === 'blink') return current >= .42 && current - baseline >= .2;
    return current >= .4 && current - baseline >= .18;
  }

  async function runCameraCapture({ challenge, mode }) {
    ensureSecureCameraContext();
    const root = ensureModal();
    const video = document.getElementById('hallaymFaceVideo');
    const camera = document.getElementById('hallaymFaceCamera');
    const action = document.getElementById('hallaymFaceAction');
    const startButton = document.getElementById('hallaymFaceStart');
    const consent = document.getElementById('hallaymFaceConsent');
    const consentWrap = document.getElementById('hallaymFaceConsentWrap');
    const needsConsent = mode === 'register' || mode === 'enroll';
    consentWrap.hidden = !needsConsent;
    consent.checked = !needsConsent;
    action.textContent = CHALLENGE_COPY[challenge]?.title || 'Yuz harakatini bajaring';
    startButton.disabled = true;
    setProgress(.05);
    setStatus('Kamera va yuz modeli tayyorlanmoqda…');

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 640, max: 1280 },
          height: { ideal: 360, max: 720 },
          aspectRatio: { ideal: 16 / 9 },
          facingMode: 'user',
          frameRate: { ideal: 24, max: 30 }
        }
      });
      video.srcObject = stream;
      await video.play();
      const model = await loadFaceModel();
      const startedAt = performance.now();
      let frames = 0;
      let lastDetectAt = 0;
      let lastSampleAt = 0;
      let baselineSamples = [];
      let baseline = 0;
      let actionScore = 0;
      let actionSeenAt = 0;
      let qualityPeak = 0;
      const descriptorSamples = [];

      return await new Promise((resolve, reject) => {
        let raf = 0;
        activeCapture = {
          cancel: () => {
            cancelAnimationFrame(raf);
            reject(new Error('Yuz tasdiqlash bekor qilindi'));
          }
        };
        const loop = () => {
          const now = performance.now();
          if (now - startedAt > 20_000) return reject(new Error('Yuz harakati vaqtida aniqlanmadi. Yorug‘likni tekshirib qayta urinib ko‘ring.'));
          raf = requestAnimationFrame(loop);
          if (video.readyState < 2 || now - lastDetectAt < 65) return;
          lastDetectAt = now;
          let result;
          try { result = model.detectForVideo(video, now); } catch (_) { return; }
          frames += 1;
          const faces = result?.faceLandmarks || [];
          if (faces.length !== 1) {
            camera.dataset.quality = 'waiting';
            setStatus(faces.length > 1 ? 'Kadrda faqat bitta yuz bo‘lishi kerak.' : 'Yuzni oval ichiga joylashtiring.', 'error');
            setProgress(.12);
            return;
          }
          const points = faces[0];
          const quality = qualityOfFace(points);
          qualityPeak = Math.max(qualityPeak, quality.qualityScore);
          if (quality.qualityScore < .52) {
            camera.dataset.quality = 'waiting';
            setStatus('Yuz to‘liq ko‘rinsin: kameraga yaqinroq va markazga qarang.', 'error');
            setProgress(.2 + quality.qualityScore * .2);
            return;
          }
          camera.dataset.quality = 'good';
          const measurement = actionMeasurement(result, points, quality, challenge);
          if (baselineSamples.length < 8) {
            baselineSamples.push(measurement);
            baseline = baselineSamples.reduce((sum, value) => sum + value, 0) / baselineSamples.length;
            if (now - lastSampleAt >= 120 && descriptorSamples.length < 6) {
              descriptorSamples.push(frameDescriptor(video, points, quality));
              lastSampleAt = now;
            }
            setStatus(`Yuz olindi. Endi ${CHALLENGE_COPY[challenge]?.short || 'topshiriqni bajaring'}…`);
            setProgress(.25 + baselineSamples.length / 8 * .25);
            return;
          }
          const deltaScore = challenge === 'turn' ? Math.abs(measurement - baseline) : measurement;
          actionScore = Math.max(actionScore, deltaScore);
          const passed = challengePassed(challenge, measurement, baseline);
          setStatus(passed ? 'Harakat aniqlandi, tasdiqlanmoqda…' : CHALLENGE_COPY[challenge]?.title || 'Jonlilik harakatini bajaring');
          setProgress(passed ? .92 : .55 + clamp(deltaScore, 0, .4));
          if (passed && !actionSeenAt) actionSeenAt = now;
          if (passed && now - actionSeenAt >= 320 && descriptorSamples.length >= 4) {
            cancelAnimationFrame(raf);
            setProgress(1);
            setStatus('Yuz va jonlilik tasdiqlandi.', 'success');
            resolve({
              template: averageDescriptors(descriptorSamples),
              consent: needsConsent ? consent.checked : true,
              liveness: {
                challenge,
                passed: true,
                durationMs: Math.round(now - startedAt),
                frames,
                actionScore: Number(Math.max(.4, Math.min(1, actionScore)).toFixed(4)),
                qualityScore: Number(Math.min(1, qualityPeak).toFixed(4))
              }
            });
          }
        };
        raf = requestAnimationFrame(loop);
      });
    } finally {
      activeCapture = null;
      stream?.getTracks?.().forEach((track) => track.stop());
      video.srcObject = null;
      startButton.disabled = false;
    }
  }

  function captureFace(options) {
    const root = ensureModal();
    const start = document.getElementById('hallaymFaceStart');
    const cancel = document.getElementById('hallaymFaceCancel');
    const consent = document.getElementById('hallaymFaceConsent');
    const needsConsent = options.mode === 'register' || options.mode === 'enroll';
    root.hidden = false;
    document.body.style.overflow = 'hidden';
    setProgress(0);
    setStatus('Boshlash tugmasini bosing.');
    document.getElementById('hallaymFaceAction').textContent = CHALLENGE_COPY[options.challenge]?.title || 'Jonlilik harakatini bajaring';

    return new Promise((resolve, reject) => {
      let settled = false;
      const close = () => {
        root.hidden = true;
        document.body.style.overflow = '';
        start.onclick = null;
        cancel.onclick = null;
      };
      cancel.onclick = () => {
        activeCapture?.cancel?.();
        if (!settled) {
          settled = true;
          close();
          reject(new Error('Yuz tasdiqlash bekor qilindi'));
        }
      };
      start.onclick = async () => {
        if (needsConsent && !consent.checked) {
          setStatus('Davom etish uchun biometrik shablonni saqlash roziligini belgilang.', 'error');
          return;
        }
        try {
          const result = await runCameraCapture(options);
          if (!settled) {
            settled = true;
            await sleep(220);
            close();
            resolve(result);
          }
        } catch (error) {
          setStatus(text(error?.message || error), 'error');
        }
      };
    });
  }

  function jsonResponse(payload, status) {
    return new Response(JSON.stringify(payload), {
      status: status || 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }

  async function readJsonClone(response) {
    try { return await response.clone().json(); } catch (_) { return null; }
  }

  function requestUrl(input) {
    if (typeof input === 'string') return new URL(input, location.href);
    if (input?.url) return new URL(input.url, location.href);
    return null;
  }

  function parseJsonBody(init) {
    if (!init?.body || typeof init.body !== 'string') return null;
    try { return JSON.parse(init.body); } catch (_) { return null; }
  }

  async function runRegistrationFetch(input, init) {
    let payload = parseJsonBody(init);
    if (!payload) return originalFetch(input, init);
    if (!payload.faceAuth?.challengeToken) {
      const challengeResponse = await originalFetch('/api/auth/face/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'register' })
      });
      const challengeData = await challengeResponse.json().catch(() => null);
      if (!challengeResponse.ok || !challengeData?.required) {
        if (challengeResponse.ok && challengeData?.required === false) return originalFetch(input, init);
        return jsonResponse({ error: challengeData?.error || 'Yuz tekshiruvi boshlanmadi' }, challengeResponse.status || 500);
      }
      const capture = await captureFace({ mode: 'register', challenge: challengeData.challenge });
      payload = {
        ...payload,
        faceAuth: {
          challengeToken: challengeData.challengeToken,
          template: capture.template,
          liveness: capture.liveness,
          consent: capture.consent
        }
      };
    }
    return originalFetch(input, { ...init, body: JSON.stringify(payload) });
  }

  async function runLoginFetch(input, init) {
    const initial = await originalFetch(input, init);
    const data = await readJsonClone(initial);
    const mode = text(data?.faceActionRequired).toLowerCase();
    if (!['enroll', 'verify'].includes(mode) || !data?.challengeToken || !data?.challenge) return initial;
    const capture = await captureFace({ mode, challenge: data.challenge });
    return originalFetch(`/api/auth/face/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeToken: data.challengeToken,
        template: capture.template,
        liveness: capture.liveness,
        consent: capture.consent
      })
    });
  }

  window.fetch = function hallaymFaceProtectedFetch(input, init) {
    const url = requestUrl(input);
    const method = text(init?.method || input?.method || 'GET').toUpperCase();
    const sameOrigin = !url || url.origin === location.origin;
    const isRegister = sameOrigin && method === 'POST' && url?.pathname === '/api/register';
    const isLogin = sameOrigin && method === 'POST' && url?.pathname === '/api/login';
    if (!isRegister && !isLogin) return originalFetch(input, init);
    if (authFlowPromise) return authFlowPromise;
    authFlowPromise = (isRegister ? runRegistrationFetch(input, init) : runLoginFetch(input, init))
      .catch((error) => jsonResponse({ error: text(error?.message || error) || 'Yuz tekshiruvi bajarilmadi' }, 400))
      .finally(() => { authFlowPromise = null; });
    return authFlowPromise;
  };
})();
