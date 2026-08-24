'use strict';

const crypto = require('crypto');

const FACE_TEMPLATE_VERSION = 1;
const FACE_TEMPLATE_ALGORITHM = 'mediapipe-landmarks-texture-v1';
const LANDMARK_VECTOR_LENGTH = 96;
const TEXTURE_VECTOR_LENGTH = 64;
const FACE_TEMPLATE_LENGTH = LANDMARK_VECTOR_LENGTH + TEXTURE_VECTOR_LENGTH;
const FACE_CHALLENGES = Object.freeze(['blink', 'smile', 'turn']);

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeFaceTemplate(raw) {
  const source = Array.isArray(raw) ? raw : raw?.values;
  if (!Array.isArray(source) || source.length !== FACE_TEMPLATE_LENGTH) {
    throw new Error(`Face template must contain ${FACE_TEMPLATE_LENGTH} values`);
  }
  const values = source.map((value) => finiteNumber(value));
  if (values.some((value) => value === null || Math.abs(value) > 12)) {
    throw new Error('Face template contains invalid values');
  }
  return values.map((value) => Number(value.toFixed(6)));
}

function deriveFaceTemplateKey(secret) {
  const value = String(secret || '').trim();
  if (value.length < 24) throw new Error('Face template secret is too short');
  return crypto.createHash('sha256').update(`hallaym-face-template:v1:${value}`, 'utf8').digest();
}

function encryptFaceTemplate(rawTemplate, secret) {
  const template = normalizeFaceTemplate(rawTemplate);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveFaceTemplateKey(secret), iv);
  cipher.setAAD(Buffer.from(FACE_TEMPLATE_ALGORITHM, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(template), 'utf8'),
    cipher.final()
  ]);
  return {
    cipherText: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    algorithm: FACE_TEMPLATE_ALGORITHM,
    templateVersion: FACE_TEMPLATE_VERSION
  };
}

function decryptFaceTemplate(bundle, secret) {
  if (!bundle || bundle.algorithm !== FACE_TEMPLATE_ALGORITHM) {
    throw new Error('Unsupported face template algorithm');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveFaceTemplateKey(secret),
    Buffer.from(String(bundle.iv || ''), 'base64')
  );
  decipher.setAAD(Buffer.from(FACE_TEMPLATE_ALGORITHM, 'utf8'));
  decipher.setAuthTag(Buffer.from(String(bundle.authTag || ''), 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(String(bundle.cipherText || ''), 'base64')),
    decipher.final()
  ]).toString('utf8');
  return normalizeFaceTemplate(JSON.parse(plain));
}

function rmsDistance(left, right, start, end) {
  let sum = 0;
  const length = Math.max(1, end - start);
  for (let index = start; index < end; index += 1) {
    const delta = Number(left[index]) - Number(right[index]);
    sum += delta * delta;
  }
  return Math.sqrt(sum / length);
}

function cosineDistance(left, right, start, end) {
  let dot = 0;
  let leftLength = 0;
  let rightLength = 0;
  for (let index = start; index < end; index += 1) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    dot += a * b;
    leftLength += a * a;
    rightLength += b * b;
  }
  if (leftLength <= 1e-9 || rightLength <= 1e-9) return 1;
  return 1 - (dot / Math.sqrt(leftLength * rightLength));
}

function compareFaceTemplates(storedRaw, candidateRaw, options = {}) {
  const stored = normalizeFaceTemplate(storedRaw);
  const candidate = normalizeFaceTemplate(candidateRaw);
  const landmarkThreshold = Math.max(0.05, Math.min(0.5, Number(options.landmarkThreshold || 0.19)));
  const textureThreshold = Math.max(0.05, Math.min(1.2, Number(options.textureThreshold || 0.42)));
  const landmarkRms = rmsDistance(stored, candidate, 0, LANDMARK_VECTOR_LENGTH);
  const textureCosine = cosineDistance(stored, candidate, LANDMARK_VECTOR_LENGTH, FACE_TEMPLATE_LENGTH);
  const landmarkScore = Math.max(0, 1 - landmarkRms / landmarkThreshold);
  const textureScore = Math.max(0, 1 - textureCosine / textureThreshold);
  return {
    match: landmarkRms <= landmarkThreshold && textureCosine <= textureThreshold,
    score: Number((landmarkScore * 0.62 + textureScore * 0.38).toFixed(4)),
    landmarkRms: Number(landmarkRms.toFixed(6)),
    textureCosine: Number(textureCosine.toFixed(6)),
    landmarkThreshold,
    textureThreshold
  };
}

function randomFaceChallenge(randomBytes = crypto.randomBytes) {
  const byte = randomBytes(1)[0];
  return FACE_CHALLENGES[byte % FACE_CHALLENGES.length];
}

function validateLivenessProof(rawProof, expectedChallenge) {
  const proof = rawProof && typeof rawProof === 'object' ? rawProof : {};
  const challenge = String(proof.challenge || '').trim().toLowerCase();
  const expected = String(expectedChallenge || '').trim().toLowerCase();
  const durationMs = finiteNumber(proof.durationMs);
  const frames = Math.floor(finiteNumber(proof.frames) || 0);
  const actionScore = finiteNumber(proof.actionScore);
  const qualityScore = finiteNumber(proof.qualityScore);

  if (!FACE_CHALLENGES.includes(expected) || challenge !== expected) {
    return { ok: false, error: 'Jonlilik topshirig‘i mos kelmadi' };
  }
  if (proof.passed !== true) return { ok: false, error: 'Jonlilik harakati tugallanmagan' };
  if (durationMs === null || durationMs < 650 || durationMs > 45_000) {
    return { ok: false, error: 'Jonlilik tekshiruvi vaqti yaroqsiz' };
  }
  if (frames < 8 || frames > 1800) return { ok: false, error: 'Kamera kadrlari yetarli emas' };
  if (actionScore === null || actionScore < 0.38 || actionScore > 1.2) {
    return { ok: false, error: 'Yuz harakati yetarli aniqlanmadi' };
  }
  if (qualityScore === null || qualityScore < 0.52 || qualityScore > 1.2) {
    return { ok: false, error: 'Yuz tasviri sifati yetarli emas' };
  }
  return {
    ok: true,
    challenge,
    durationMs: Math.round(durationMs),
    frames,
    actionScore: Number(actionScore.toFixed(4)),
    qualityScore: Number(qualityScore.toFixed(4))
  };
}

module.exports = {
  FACE_TEMPLATE_VERSION,
  FACE_TEMPLATE_ALGORITHM,
  LANDMARK_VECTOR_LENGTH,
  TEXTURE_VECTOR_LENGTH,
  FACE_TEMPLATE_LENGTH,
  FACE_CHALLENGES,
  normalizeFaceTemplate,
  deriveFaceTemplateKey,
  encryptFaceTemplate,
  decryptFaceTemplate,
  compareFaceTemplates,
  randomFaceChallenge,
  validateLivenessProof
};
