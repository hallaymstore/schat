const {
  $, apiFetch, getMe, initStoredTheme, applyTheme, renderHeaderMeta, logout,
  normalizeCourse, escapeHtml, money
} = window.CourseSuite;

const COURSES_STATE = { me: null, courses: [], recommendations: [], filtered: [], previewCleanup: new WeakMap() };

function setAlert(type, message){
  const box = $('pageAlert');
  if(!box) return;
  box.className = `course-alert show ${type === 'error' ? 'error' : 'success'}`;
  box.textContent = message;
}

function clearAlert(){
  const box = $('pageAlert');
  if(!box) return;
  box.className = 'course-alert';
  box.textContent = '';
}

function youtubeId(url){
  const value = String(url || '').trim();
  if(!value) return '';
  const match = value.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/i);
  return match ? match[1] : '';
}

function previewSource(course){
  const media = course.previewMedia || {};
  const youtubeUrl = String(media.youtubeUrl || course.youtubeUrl || '').trim();
  const videoUrl = String(media.videoUrl || '').trim();
  if(youtubeId(youtubeUrl)) return { type: 'youtube', url: youtubeUrl, id: youtubeId(youtubeUrl) };
  if(videoUrl) return { type: 'video', url: videoUrl };
  return null;
}

function thumbnailFor(course){
  if(course.coverUrl) return course.coverUrl;
  const source = previewSource(course);
  return source?.type === 'youtube' ? `https://i.ytimg.com/vi/${encodeURIComponent(source.id)}/hqdefault.jpg` : '';
}

function formatDuration(course){
  const minutes = Number(course.previewMedia?.durationMinutes || course.durationMinutes || 0);
  if(!minutes) return `${course.lessonCount || 0} dars`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}:${String(rest).padStart(2, '0')}:00` : `${minutes}:00`;
}

function matchCourse(course){
  const q = String($('searchInput').value || '').trim().toLowerCase();
  const faculty = $('facultyFilter').value || '';
  const category = $('categoryFilter').value || '';
  const price = $('priceFilter').value || '';
  const joinMode = $('joinModeFilter').value || '';
  if(faculty && course.faculty !== faculty) return false;
  if(category && course.category !== category) return false;
  if(price && course.type !== price) return false;
  if(joinMode && course.joinMode !== joinMode) return false;
  if(!q) return true;
  return [course.title, course.description, course.teacherName, course.faculty, course.category, ...(course.tags || []), ...(course.studyDirections || []), ...(course.groups || [])]
    .join(' ').toLowerCase().includes(q);
}

function sortCourses(list){
  const mode = $('sortFilter').value || 'new';
  return [...list].sort((a, b)=>{
    if(mode === 'title') return String(a.title || '').localeCompare(String(b.title || ''), 'uz');
    if(mode === 'rating') return Number(b.ratingAverage || 0) - Number(a.ratingAverage || 0);
    if(mode === 'lessons') return Number(b.lessonCount || 0) - Number(a.lessonCount || 0);
    if(mode === 'price') return Number(a.price || 0) - Number(b.price || 0);
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });
}

function renderSummary(){
  $('catalogCount').textContent = String(COURSES_STATE.filtered.length);
  $('teacherCount').textContent = String(new Set(COURSES_STATE.courses.map((course)=>String(course.teacherId || '')).filter(Boolean)).size);
  $('lessonCount').textContent = String(COURSES_STATE.courses.reduce((sum, course)=>sum + Number(course.lessonCount || 0), 0));
}

function stopPreview(host){
  const cleanup = COURSES_STATE.previewCleanup.get(host);
  if(cleanup) cleanup();
  COURSES_STATE.previewCleanup.delete(host);
  host.querySelector('.yt-preview-layer')?.replaceChildren();
  host.classList.remove('is-previewing');
}

function startPreview(host, course){
  const source = previewSource(course);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.connection?.saveData;
  if(!source || reduced || host.classList.contains('is-previewing')) return;
  const layer = host.querySelector('.yt-preview-layer');
  if(!layer) return;
  host.classList.add('is-previewing');
  let interval = 0;
  if(source.type === 'video'){
    const video = document.createElement('video');
    Object.assign(video, { muted: true, autoplay: true, loop: false, playsInline: true, preload: 'metadata' });
    video.src = source.url;
    layer.replaceChildren(video);
    const seekPoints = [.08, .42, .76];
    let index = 0;
    const seek = ()=>{
      if(Number.isFinite(video.duration) && video.duration > 12){
        video.currentTime = Math.min(video.duration - 2, Math.max(0, video.duration * seekPoints[index % seekPoints.length]));
        index += 1;
      }
      video.play().catch(()=>{});
    };
    video.addEventListener('loadedmetadata', seek, { once: true });
    interval = window.setInterval(seek, 7000);
  }else{
    const starts = [0, 35, 75];
    let index = 0;
    const mount = ()=>{
      const iframe = document.createElement('iframe');
      iframe.title = `${course.title} tezkor preview`;
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(source.id)}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0&modestbranding=1&start=${starts[index++ % starts.length]}`;
      layer.replaceChildren(iframe);
    };
    mount();
    interval = window.setInterval(mount, 7000);
  }
  COURSES_STATE.previewCleanup.set(host, ()=>{
    clearInterval(interval);
    layer.querySelectorAll('video').forEach((video)=>{ video.pause(); video.removeAttribute('src'); video.load(); });
    layer.querySelectorAll('iframe').forEach((iframe)=>{ iframe.src = 'about:blank'; });
  });
}

function bindPreviews(list, pool = COURSES_STATE.filtered){
  list.querySelectorAll('[data-preview-course]').forEach((host)=>{
    const course = pool.find((item)=>String(item.id) === String(host.dataset.previewCourse));
    if(!course) return;
    let timer = 0;
    const enter = ()=>{ timer = window.setTimeout(()=>startPreview(host, course), 320); };
    const leave = ()=>{ clearTimeout(timer); stopPreview(host); };
    host.addEventListener('pointerenter', enter);
    host.addEventListener('pointerleave', leave);
    host.addEventListener('focusin', enter);
    host.addEventListener('focusout', leave);
  });
}

function courseCardMarkup(course, options = {}){
  const meId = String(COURSES_STATE.me?._id || '');
  const role = String(COURSES_STATE.me?.role || 'student').toLowerCase();
  const canManage = role === 'admin' || (meId && String(course.teacherId || '') === meId);
  const thumb = thumbnailFor(course);
  const hasPreview = !!previewSource(course);
  return `
    <article class="yt-course-card">
      <a class="yt-course-thumb" data-preview-course="${escapeHtml(course.id)}" href="/course.html?id=${encodeURIComponent(course.id)}" aria-label="${escapeHtml(course.title)} kursini ochish">
        ${thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy">` : '<span class="yt-course-placeholder">H</span>'}
        <span class="yt-preview-layer" aria-hidden="true"></span>
        <span class="yt-course-duration">${escapeHtml(formatDuration(course))}</span>
        ${hasPreview ? '<span class="yt-preview-label">7 soniyalik preview</span>' : ''}
      </a>
      <div class="yt-course-info">
        <div class="yt-teacher-avatar" aria-hidden="true">${escapeHtml(String(course.teacherName || 'U').trim().charAt(0).toUpperCase() || 'U')}</div>
        <div class="yt-course-copy">
          <a class="yt-course-title" href="/course.html?id=${encodeURIComponent(course.id)}">${escapeHtml(course.title)}</a>
          <div class="yt-course-teacher">${escapeHtml(course.teacherName || "O‘qituvchi")}</div>
          <div class="yt-course-meta">${course.lessonCount || 0} dars · ${course.likeCount || 0} yoqdi · ${course.commentCount || 0} izoh · ★ ${Number(course.ratingAverage || 0).toFixed(1)}</div>
          <div class="yt-course-tags"><span>${course.type === 'paid' ? escapeHtml(money(course.price)) : 'Bepul'}</span><span>${escapeHtml(course.category || course.level || 'beginner')}</span>${options.reason ? `<span class="yt-recommend-reason">${escapeHtml(options.reason)}</span>` : ''}</div>
        </div>
      </div>
      ${canManage ? `<div class="yt-course-manage"><a href="/course-studio.html?id=${encodeURIComponent(course.id)}">Tahrirlash</a><a href="/course-progress.html?id=${encodeURIComponent(course.id)}">Natijalar</a><button data-action="duplicate" data-id="${escapeHtml(course.id)}">Nusxa</button><button data-action="delete" data-id="${escapeHtml(course.id)}">O‘chirish</button></div>` : ''}
    </article>`;
}

function renderCourses(){
  const list = $('courseList');
  COURSES_STATE.filtered = sortCourses(COURSES_STATE.courses.filter(matchCourse));
  renderSummary();
  if(!COURSES_STATE.filtered.length){
    list.innerHTML = '<div class="course-empty">Mos kurs topilmadi. Qidiruv yoki filterlarni o‘zgartiring.</div>';
    return;
  }
  list.innerHTML = COURSES_STATE.filtered.map((course)=>courseCardMarkup(course)).join('');
  bindPreviews(list);
  list.querySelectorAll('[data-action="duplicate"]').forEach((button)=>button.addEventListener('click', ()=>duplicateCourse(button.dataset.id)));
  list.querySelectorAll('[data-action="delete"]').forEach((button)=>button.addEventListener('click', ()=>deleteCourse(button.dataset.id)));
}

async function loadRecommendations(){
  const section = $('recommendedSection');
  const list = $('recommendedList');
  try{
    const data = await apiFetch('/api/courses/recommendations?limit=8');
    COURSES_STATE.recommendations = (Array.isArray(data?.courses) ? data.courses : []).map((raw)=>({
      ...normalizeCourse(raw),
      recommendationReason: raw.recommendationReason || ''
    }));
    section.hidden = !COURSES_STATE.recommendations.length;
    list.innerHTML = COURSES_STATE.recommendations.map((course)=>courseCardMarkup(course, { reason: course.recommendationReason })).join('');
    bindPreviews(list, COURSES_STATE.recommendations);
  }catch(_){
    section.hidden = true;
  }
}

async function loadCourses(){
  const data = await apiFetch('/api/courses');
  COURSES_STATE.courses = (Array.isArray(data?.courses) ? data.courses : []).map(normalizeCourse);
  const faculties = Array.from(new Set(COURSES_STATE.courses.map((course)=>course.faculty).filter(Boolean)));
  const categories = Array.from(new Set(COURSES_STATE.courses.map((course)=>course.category).filter(Boolean)));
  $('facultyFilter').innerHTML = '<option value="">Fakultet: barchasi</option>' + faculties.map((faculty)=>`<option value="${escapeHtml(faculty)}">${escapeHtml(faculty)}</option>`).join('');
  $('categoryFilter').innerHTML = '<option value="">Fanlar: barchasi</option>' + categories.map((category)=>`<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
  renderCourses();
}

async function duplicateCourse(courseId){
  try{
    clearAlert();
    const [detail, content] = await Promise.all([
      apiFetch(`/api/courses/${encodeURIComponent(courseId)}`),
      apiFetch(`/api/courses/${encodeURIComponent(courseId)}/content`).catch(()=>({ items: [] }))
    ]);
    const course = normalizeCourse(detail?.course || detail);
    await apiFetch('/api/courses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `${course.title} (nusxa)`, description: course.description, type: course.type,
        price: course.price, status: 'draft', joinMode: course.joinMode,
        visibility: course.visibility, category: course.category, tags: course.tags, studyDirections: course.studyDirections,
        allowComments: course.allowComments, allowRatings: course.allowRatings,
        allowSequential: course.allowSequential, faculty: course.faculty, groups: course.groups,
        youtubeUrl: course.youtubeUrl, coverUrl: course.coverUrl, language: course.language,
        level: course.level, requirements: course.requirements, outcomes: course.outcomes,
        lessons: Array.isArray(content?.items) ? content.items : []
      })
    });
    await loadCourses();
    setAlert('success', 'Kurs nusxasi draft holatda yaratildi.');
  }catch(error){ setAlert('error', error.message || 'Kurs nusxalanmadi.'); }
}

async function deleteCourse(courseId){
  const course = COURSES_STATE.courses.find((item)=>String(item.id) === String(courseId));
  if(!course || !confirm(`“${course.title}” kursini o‘chirasizmi?`)) return;
  try{
    await apiFetch(`/api/courses/${encodeURIComponent(courseId)}`, { method: 'DELETE' });
    await loadCourses();
    setAlert('success', 'Kurs o‘chirildi.');
  }catch(error){ setAlert('error', error.message || 'Kurs o‘chirilmadi.'); }
}

async function init(){
  initStoredTheme();
  applyTheme($('themeBtn'));
  $('logoutBtn').addEventListener('click', logout);
  COURSES_STATE.me = await getMe();
  if(!COURSES_STATE.me) return;
  renderHeaderMeta(COURSES_STATE.me, { roleBadge: 'roleBadge', mePill: 'mePill', dashboardLink: 'dashboardLink' });
  const role = String(COURSES_STATE.me.role || '').toLowerCase();
  $('createCourseBtn').style.display = ['teacher', 'admin'].includes(role) ? 'inline-flex' : 'none';
  $('createCourseBtn').addEventListener('click', ()=>{ location.href = '/course-studio.html'; });
  ['searchInput', 'facultyFilter', 'categoryFilter', 'priceFilter', 'joinModeFilter', 'sortFilter'].forEach((id)=>{
    $(id).addEventListener('input', renderCourses);
    $(id).addEventListener('change', renderCourses);
  });
  $('refreshBtn').addEventListener('click', async ()=>{ clearAlert(); await loadCourses(); setAlert('success', 'Kurslar yangilandi.'); });
  await Promise.all([loadCourses(), loadRecommendations()]);
}

init().catch((error)=>setAlert('error', error.message || 'Kurslar yuklanmadi.'));
