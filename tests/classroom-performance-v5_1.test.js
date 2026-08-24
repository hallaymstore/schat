const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('teacher stage keeps one full-frame 16:9 primary slot', () => {
  const html = read('public/group.html');
  const css = read('public/enterprise-accessible.css');
  assert.match(css, /#teacherStage\s*\{[\s\S]*?aspect-ratio:\s*16\s*\/\s*9\s*!important/);
  assert.match(css, /#teacherStageViewport,[\s\S]*?aspect-ratio:\s*auto\s*!important/);
  assert.match(css, /#teacherStageSurface\s*>\s*\.stage-slot-primary,[\s\S]*?position:\s*absolute\s*!important/);
  assert.match(css, /#teacherStage \.stage-slot-primary video[\s\S]*?object-fit:\s*contain\s*!important/);
  assert.match(html, /queueMicrotask\([\s\S]*?renderGroupCallLayout\(\)/);
  assert.match(html, /matchingSlot\.querySelectorAll\('\.stage-placeholder'\)/);
});

test('global background loading is invisible, non-blocking and short-lived', () => {
  const loader = read('public/global-loader.js');
  assert.match(loader, /#schatGlobalLoader\{display:none!important;pointer-events:none!important;/);
  assert.doesNotMatch(loader, /@keyframes\s+schatLoaderSpin/);
  assert.match(loader, /data-background-loading/);
  assert.match(loader, /},\s*1500\);/);
  assert.match(loader, /edu-lite-runtime/);
});

test('AI camera zooms out for a close face and tracks distant face or pointer', () => {
  const assistant = read('public/accessibility-assistant.js');
  assert.match(assistant, /scale:\s*clamp\(\.38\s*\/\s*width,\s*1,\s*2\.85\)/);
  assert.match(assistant, /focusRender\.scale\s*<=\s*1\.035/);
  assert.match(assistant, /Math\.min\(canvas\.width\s*\/\s*sourceW,\s*canvas\.height\s*\/\s*sourceH\)/);
  assert.match(assistant, /mode:\s*'point',\s*scale:\s*2\.55/);
  assert.match(assistant, /handInterval\s*=\s*lite\s*\?\s*150\s*:\s*105/);
  assert.match(assistant, /faceInterval\s*=\s*lite\s*\?\s*240\s*:\s*155/);
  assert.match(assistant, /AI kamera fokusi/);
});

test('captions switch Uzbek English Russian without a stale recognizer', () => {
  const html = read('public/group.html');
  assert.match(html, /_captionTranscriberGeneration/);
  assert.match(html, /_captionTranscriberLocale\s*!==\s*wantedLocale/);
  assert.match(html, /setTimeout\(startLiveCaptionTranscriber,\s*40\)/);
  assert.match(html, /},\s*90\);/);
  assert.match(html, /},\s*1200\);/);
  assert.match(html, /_captionTranslateController\?\.abort/);
  assert.match(html, /rec\.interimResults\s*=\s*true/);
  assert.match(html, /rec\.continuous\s*=\s*true/);
});

test('final application palette is consistently white and blue', () => {
  const lms = read('public/lms-core-v3.css');
  const glass = read('public/ui-glass-theme.css');
  const profile = read('public/profile.html');
  const premium = read('public/premium-ui.js');
  const server = read('server115007.js');
  assert.match(lms, /v5\.1 single brand palette/);
  assert.match(lms, /#cover:not\(\[style\*="url\("\]\)[\s\S]*?#1d5fa8/);
  assert.match(glass, /v5\.1 palette lock/);
  assert.match(glass, /\.btn\.primary[\s\S]*?background:\s*#1d5fa8\s*!important/);
  assert.match(profile, /HALLAYM white\/blue brand accents/);
  assert.match(profile, /activeRobot\?\.baseColor\s*\|\|\s*'#2878c7'/);
  assert.doesNotMatch(premium, /rgba\(15,\s*143,\s*131/);
  assert.match(server, /theme-color[^\n]*#176fae/);
});
