const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const faceAuth = require('../src/security/face-auth');

function makeTemplate() {
  return Array.from({ length: faceAuth.FACE_TEMPLATE_LENGTH }, (_, index) => {
    if (index < faceAuth.LANDMARK_VECTOR_LENGTH) return ((index % 17) - 8) / 20;
    return ((index * 13) % 97) / 96;
  });
}

test('face template is normalized, encrypted with authenticated encryption and recoverable', () => {
  const secret = 'v5.3-test-face-template-secret-with-48-characters';
  const template = makeTemplate();
  const encrypted = faceAuth.encryptFaceTemplate(template, secret);

  assert.equal(encrypted.algorithm, faceAuth.FACE_TEMPLATE_ALGORITHM);
  assert.ok(encrypted.cipherText.length > 100);
  assert.notEqual(encrypted.cipherText, JSON.stringify(template));
  assert.deepEqual(faceAuth.decryptFaceTemplate(encrypted, secret), faceAuth.normalizeFaceTemplate(template));
  assert.throws(() => faceAuth.decryptFaceTemplate(encrypted, `${secret}-wrong`));
});

test('face matcher accepts the same template and rejects a different face vector', () => {
  const stored = makeTemplate();
  const same = stored.map((value, index) => value + (index % 2 ? 0.001 : -0.001));
  const other = stored.map((value, index) => (
    index < faceAuth.LANDMARK_VECTOR_LENGTH ? value + 0.75 : 1 - value
  ));

  assert.equal(faceAuth.compareFaceTemplates(stored, same).match, true);
  assert.equal(faceAuth.compareFaceTemplates(stored, other).match, false);
});

test('liveness proof must match the server challenge and minimum camera evidence', () => {
  const valid = {
    challenge: 'blink',
    passed: true,
    durationMs: 1800,
    frames: 32,
    actionScore: 0.72,
    qualityScore: 0.83
  };
  assert.equal(faceAuth.validateLivenessProof(valid, 'blink').ok, true);
  assert.equal(faceAuth.validateLivenessProof(valid, 'smile').ok, false);
  assert.equal(faceAuth.validateLivenessProof({ ...valid, passed: false }, 'blink').ok, false);
  assert.equal(faceAuth.validateLivenessProof({ ...valid, qualityScore: 0.2 }, 'blink').ok, false);
});

test('registration and login are protected by single-use face challenges', () => {
  const server = read('server115007.js');
  assert.match(server, /app\.post\('\/api\/auth\/face\/challenge'/);
  assert.match(server, /app\.post\('\/api\/auth\/face\/enroll'/);
  assert.match(server, /app\.post\('\/api\/auth\/face\/verify'/);
  assert.match(server, /User\.findOneAndUpdate\(\{[\s\S]*?'faceAuth\.pendingChallengeHash'/);
  assert.doesNotMatch(server, /mongoose\.model\('FaceAuthChallenge'/);
  assert.match(server, /code:\s*'FACE_VERIFICATION_REQUIRED'/);
  assert.match(server, /decoded\?\.faceVerified\s*!==\s*true/);
  assert.match(server, /select:\s*false/);
  assert.match(server, /app\.post\('\/api\/admin\/users\/:id\/face-reset'/);
});

test('browser face gate requires one face, consent and a random liveness action', () => {
  const client = read('public/face-auth.js');
  const style = read('public/face-auth.css');
  assert.match(client, /numFaces:\s*2/);
  assert.match(client, /faces\.length\s*!==\s*1/);
  assert.match(client, /consent/);
  assert.match(client, /blink|smile|turn/);
  assert.match(client, /stream\?\.getTracks\?\.\(\)\.forEach/);
  assert.match(style, /#hallaymFaceAuth/);
  assert.match(style, /html\[data-theme="dark"\]/);
});

test('tutor is a scoped academic role with a dedicated dashboard', () => {
  const server = read('server115007.js');
  const dashboard = read('public/tutor-dashboard.html');
  const admin = read('public/admin-dashboard.html');
  assert.match(server, /SCOPED_ACADEMIC_ROLES\s*=\s*new Set\(\['tutor'/);
  assert.match(server, /FACULTY_SCOPED_ROLES\s*=\s*new Set\(\['tutor'/);
  assert.match(server, /SCOPED_WRITE_ROLES\s*=\s*new Set\(\['tutor'/);
  assert.match(dashboard, /Tyutor paneli/);
  assert.match(dashboard, /\/api\/organizer\/overview/);
  assert.match(dashboard, /\/api\/organizer\/groups/);
  assert.match(dashboard, /\/api\/organizer\/group-lessons/);
  assert.match(admin, /value="tutor"/);
  assert.match(admin, /face-reset/);
});

test('v5.3 palette contract keeps readable blue-white light and dark surfaces', () => {
  const css = read('public/lms-core-v3.css');
  assert.match(css, /v5\.3 contrast contract/);
  assert.match(css, /html\.dark\s*\{[\s\S]*?--lms-bg:\s*#07131d/);
  assert.match(css, /html\.dark body/);
  assert.match(css, /#infoPanel/);
  assert.match(css, /\.message-bubble\.sent/);
  assert.match(css, /\.message-bubble\.received/);
});
