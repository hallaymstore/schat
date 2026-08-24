const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('enterprise theme enforces compact white/blue classroom shell', () => {
  const css = `${read('public/enterprise-accessible.css')}\n${read('public/lms-core-v3.css')}`;
  assert.match(css, /--edu-blue-700:\s*#1d5fa8/i);
  assert.match(css, /#teacherStage[\s\S]*?aspect-ratio:\s*16\s*\/\s*9\s*!important/i);
  assert.match(css, /#stageWhiteboardLayer[\s\S]*?aspect-ratio:\s*16\s*\/\s*9\s*!important/i);
  assert.match(css, /#eduFaceFocusPip[\s\S]*?aspect-ratio:\s*16\s*\/\s*9/i);
  assert.match(css, /border-radius:\s*3px\s*!important/i);
  assert.match(css, /#groupCallOverlay[\s\S]*?background:\s*#02070c\s*!important/i);
});

test('voice assistant includes required Uzbek navigation and chat commands', () => {
  const js = read('public/accessibility-assistant.js');
  for (const phrase of [
    'Guruhimga kir',
    'Darsga qo‘shil',
    'Chatga yoz',
    'Oxirgi 3 ta xabarni o‘qi',
    'Subtitrlarni yoq'
  ]) {
    assert.ok(js.includes(phrase), `missing voice command: ${phrase}`);
  }
  assert.match(js, /SpeechRecognition\s*\|\|\s*window\.webkitSpeechRecognition/);
  assert.match(js, /speechSynthesis/);
  assert.match(js, /suspendedForSpeech/);
  assert.match(js, /recognition\.abort/);
  for (const feature of ['setThemeMode', 'focusInteractive', 'setCaptionLanguage', 'setNavigationGesturesEnabled']) {
    assert.match(js, new RegExp(`function\\s+${feature}`));
  }
});

test('gesture assistant supports face focus, point freeze reset and board shapes', () => {
  const js = read('public/accessibility-assistant.js');
  assert.match(js, /HandLandmarker/);
  assert.match(js, /FaceLandmarker/);
  for (const mode of ['point', 'freeze', 'fist', 'circle', 'rectangle', 'line']) {
    assert.ok(js.includes(`'${mode}'`), `missing gesture mode: ${mode}`);
  }
  assert.match(js, /drawWhiteboardShape/);
  assert.match(js, /emitStageFocus/);
  assert.match(js, /processNavigationGesture/);
  assert.match(js, /Chimchilash/);
  assert.match(js, /cycleGestureTarget/);
  assert.match(js, /Kaftni chap\/o‘ng silkiting/);
  const focusBlock = js.slice(js.indexOf('function applyStageFocus'), js.indexOf('function emitStageFocus'));
  assert.match(focusBlock, /eduFaceFocusPip/);
  assert.doesNotMatch(focusBlock, /teacherStageZoom\.|applyTeacherStageZoom/);
});

test('whiteboard is a separate synchronized PiP with transformable objects', () => {
  const html = read('public/group.html');
  for (const tool of ['pen', 'select', 'text', 'line', 'arrow', 'rectangle', 'circle']) {
    assert.ok(html.includes(`data-wb-tool="${tool}"`) || html.includes(`setStageWhiteboardTool('${tool}')`), `missing whiteboard tool: ${tool}`);
  }
  assert.match(html, /wbTextFont/);
  assert.match(html, /wbTextSize/);
  assert.match(html, /undoStageWhiteboard/);
  assert.match(html, /redoStageWhiteboard/);
  assert.doesNotMatch(html, /id="stageWhiteboardCamPip"/);
  assert.match(html, /groupWhiteboardState/);
  assert.match(html, /groupWhiteboardOp/);
  assert.match(html, /emitStageWhiteboardStroke/);
  assert.match(html, /transformSelectedStageWhiteboardObject/);
  assert.match(html, /selectedShapeId/);
  assert.match(html, /shapeTransform/);
  assert.match(html, /toggleStageWhiteboardPipSize/);
  assert.match(html, /describeMediaCaptureError/);
  const startBlock = html.slice(html.indexOf('async function startStageWhiteboardMode'), html.indexOf('async function stopStageWhiteboardMode'));
  assert.doesNotMatch(startBlock, /replaceOutgoingStageVideoTrack|captureStream|stageWhiteboardCamPip/);
});

test('landing is full-width and exposes accessible entry points', () => {
  const html = read('public/index.html');
  assert.match(html, /class="lms-landing"/);
  assert.match(html, /HALLAYM EDU/);
  assert.match(html, /setNavigationGesturesEnabled/);
  assert.match(html, /href="\/login\.html"/);
  assert.match(html, /href="\/register\.html"/);
});

test('server injects accessibility assets and authorizes gesture relay', () => {
  const server = read('server115007.js');
  assert.match(server, /GLOBAL_ENTERPRISE_STYLESHEET/);
  assert.match(server, /GLOBAL_ACCESSIBILITY_SCRIPT/);
  assert.match(server, /GLOBAL_LMS_V3_STYLESHEET/);
  assert.match(server, /socket\.on\('groupStageGesture'/);
  assert.match(server, /socket\.on\('groupWhiteboardState'/);
  assert.match(server, /socket\.on\('groupWhiteboardRequest'/);
  assert.match(server, /socket\.on\('groupWhiteboardOp'/);
  assert.match(server, /ownerTeacherId/);
  assert.match(server, /now - Number\(socket\._lastGroupStageGestureAt/);
});

test('production configuration uses environment secrets, CORS and resilient services', () => {
  const server = read('server115007.js');
  const mediasoup = read('rtc-mediasoup.js');
  const rtc = read('src/realtime/rtc-config.js');
  assert.match(server, /JWT_ACCESS_SECRET/);
  assert.match(server, /AUTH_JWT_SECRET/);
  assert.match(server, /CORS_ORIGINS/);
  assert.match(server, /BOOTSTRAP_ADMIN_PASSWORD/);
  assert.doesNotMatch(server, /admin0877hallaym|0877admin\+\+hallaym/);
  assert.match(server, /MONGODB_MAX_POOL_SIZE/);
  assert.match(server, /STORAGE_DRIVER/);
  assert.match(server, /Strict-Transport-Security/);
  assert.match(mediasoup, /MEDIASOUP_MAX_PEERS_PER_ROOM/);
  assert.match(rtc, /TURN_TTL_SECONDS/);
});
