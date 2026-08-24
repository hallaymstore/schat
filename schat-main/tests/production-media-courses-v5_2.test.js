const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('SFU falls back to one coordinated ExpressTURN mesh room when media never arrives', () => {
  const group = read('public/group.html');
  const server = read('server115007.js');
  assert.match(group, /SFU_MAX_RECONNECT_ATTEMPTS\s*=\s*2/);
  assert.match(group, /SFU_MAX_NO_MEDIA_CYCLES\s*=\s*1/);
  assert.match(group, /hasRenderableRemoteMedia\(\)/);
  assert.match(group, /bootstrapMeshFallback\(`\$\{reason\}-no-remote-media`/);
  assert.match(group, /bootstrapMeshFallback\(`\$\{reason\}-connect-failed`/);
  assert.match(group, /groupCallTransportFallback/);
  assert.match(server, /socket\.on\('groupCallTransportFallback'/);
  assert.match(server, /io\.to\(getGroupRoomName\(groupId\)\)\.emit\('groupCallTransportFallback'/);
  assert.match(group, /GROUP_REMOTE_AUDIO_MIC_ON_NON_STAGE_VOLUME\s*=\s*0\.42/);
});

test('RTC health reports only safe TURN and mediasoup readiness', () => {
  const server = read('server115007.js');
  assert.match(server, /app\.get\('\/api\/rtc-health'/);
  assert.match(server, /publicAnnouncedAddress/);
  assert.match(server, /serverGroups/);
  assert.match(server, /warnings/);
  const healthBlock = server.slice(server.indexOf("app.get('/api/rtc-health'"), server.indexOf('const rtcConfigController'));
  assert.doesNotMatch(healthBlock, /credential\s*:/i);
  assert.doesNotMatch(healthBlock, /secret\s*:/i);
});

test('group list payload and card expose active live lesson without a blocking loader', () => {
  const server = read('server115007.js');
  const groups = read('public/groups.html');
  assert.match(server, /liveLesson:\s*activeCall\s*\?/);
  assert.match(server, /participantCount:\s*Number\(activeCall\.participants\?\.size/);
  assert.match(groups, /group-live-dot/);
  assert.match(groups, /JONLI:/);
  assert.match(groups, /Darsga qo‘shilish/);
  assert.match(groups, /setInterval\([\s\S]*?7000\)/);
});

test('teacher studio uploads 1GB videos as resumable bounded R2 multipart requests', () => {
  const server = read('server115007.js');
  const studio = read('public/course-studio.js');
  const html = read('public/course-studio.html');
  for (const command of ['CreateMultipartUploadCommand', 'UploadPartCommand', 'CompleteMultipartUploadCommand', 'AbortMultipartUploadCommand', 'ListPartsCommand']) {
    assert.match(server, new RegExp(command));
  }
  assert.match(server, /COURSE_VIDEO_MAX_BYTES/);
  assert.match(server, /COURSE_VIDEO_PART_BYTES/);
  assert.match(server, /express\.raw\(\{\s*type:\s*'application\/octet-stream'/);
  assert.match(server, /video-upload\/start/);
  assert.match(server, /video-upload\/status/);
  assert.match(server, /video-upload\/part\/:partNumber/);
  assert.match(server, /video-upload\/complete/);
  assert.match(studio, /file\.slice\(start, end\)/);
  assert.match(studio, /Promise\.all\(\[worker\(\), worker\(\)\]\)/);
  assert.match(studio, /localStorage\.setItem\(storageKey/);
  assert.match(studio, /Ulanish uzildi\. Shu faylni qayta tanlab bosilsa davom etadi/);
  assert.match(html, /largeVideoPauseBtn/);
  assert.match(html, /largeVideoCancelBtn/);
});

test('published public courses, community actions and recommendations are open to students', () => {
  const server = read('server115007.js');
  const catalog = read('public/courses-app.js');
  const detail = read('public/course-detail.js');
  assert.match(server, /visibility:\s*\{\s*type:\s*String,\s*enum:\s*\['public', 'university', 'restricted'\]/);
  assert.match(server, /const visibility = String\(course\.visibility \|\| 'public'\)/);
  assert.match(server, /app\.get\('\/api\/courses\/recommendations'/);
  assert.match(server, /sameGroup[\s\S]*?score \+= 80/);
  assert.match(server, /sameFaculty[\s\S]*?score \+= 45/);
  assert.match(catalog, /loadRecommendations/);
  assert.match(catalog, /recommendationReason/);
  assert.match(detail, /course\.visibility === 'public'/);
  assert.match(detail, /loadRecommendations/);
});

test('version and server handoff cover v5.2 production ports, health and large videos', () => {
  const pkg = JSON.parse(read('package.json'));
  const envExample = read('.env.example');
  const handoff = read('docs/CODEX-SERVER-HANDOFF.md');
  assert.equal(pkg.version, '5.2.0');
  assert.match(envExample, /EXPRESSTURN_SECRET_KEY=/);
  assert.match(envExample, /COURSE_VIDEO_MAX_GB=5/);
  assert.match(handoff, /GET \/api\/rtc-health/);
  assert.match(handoff, /UDP va TCP `40000–49999`/);
  assert.match(handoff, /1 GB\+ videolar 8 MB/);
});
