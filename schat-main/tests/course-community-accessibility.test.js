const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('course backend supports per-video likes and comment likes', () => {
  const server = read('server115007.js');
  assert.match(server, /const CourseLikeSchema/);
  assert.match(server, /contentId:[\s\S]*ref: 'CourseContent'/);
  assert.match(server, /app\.get\('\/api\/courses\/:id\/likes'/);
  assert.match(server, /app\.post\('\/api\/courses\/:id\/likes'/);
  assert.match(server, /app\.post\('\/api\/courses\/:id\/comments\/:commentId\/like'/);
  assert.match(server, /likeCountMap/);
});

test('course catalog and watch page expose YouTube-style media flows', () => {
  const catalog = read('public/courses-app.js');
  const watch = read('public/course-detail.js');
  const css = read('public/course-suite.css');
  assert.match(catalog, /previewSource/);
  assert.match(catalog, /setInterval\(seek, 7000\)/);
  assert.match(catalog, /youtube-nocookie\.com\/embed/);
  assert.match(watch, /yt-watch-layout/);
  assert.match(watch, /toggleVideoLike/);
  assert.match(watch, /toggleCommentLike/);
  assert.match(css, /aspect-ratio:16\/9/);
});

test('voice assistant buffers long speech and resumes across navigation', () => {
  const assistant = read('public/accessibility-assistant.js');
  assert.match(assistant, /VOICE_QUIET_WINDOW_MS = 5000/);
  assert.match(assistant, /VOICE_MAX_UTTERANCE_MS = 60000/);
  assert.match(assistant, /finalSegments/);
  assert.match(assistant, /tolerantVoiceCommand/);
  assert.match(assistant, /localStorage\.getItem\(VOICE_ENABLED_KEY\) === '1'/);
  assert.doesNotMatch(assistant, /Buyruq tushunilmadi/);
});

test('optional accessibility profile and automatic role-aware avatars are present', () => {
  const server = read('server115007.js');
  const register = read('public/register.html');
  const profile = read('public/profile.html');
  const fallback = read('public/avatar-fallback.js');
  assert.match(server, /accessibilityProfile/);
  assert.match(server, /gender: \{ type: String, enum:/);
  assert.match(server, /\/api\/avatar-placeholder\/:userId\.svg/);
  assert.match(register, /name="assistancePreferences"/);
  assert.match(register, /name="gender"/);
  assert.match(profile, /editAccessibilityDisclosure/);
  assert.match(profile, /editGender/);
  assert.match(fallback, /MutationObserver/);
});
