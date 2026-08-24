const {
  $, qs, apiFetch, getMe, initStoredTheme, applyTheme, renderHeaderMeta, logout,
  normalizeCourse, normalizeLesson, escapeHtml, money, shortText, formatDate
} = window.CourseSuite;

const WATCH_STATE = {
  me: null, course: null, lessons: [], comments: [], ratings: [],
  ratingSummary: { average: 0, count: 0 }, selectedLessonId: '', replyParentId: '',
  like: { count: 0, liked: false }, recommendations: []
};

function showAlert(type, message){
  const box = $('pageAlert');
  box.className = `course-alert show ${type === 'error' ? 'error' : 'success'}`;
  box.textContent = message;
}
function clearAlert(){ $('pageAlert').className = 'course-alert'; $('pageAlert').textContent = ''; }

function youtubeId(url){
  const match = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/i);
  return match ? match[1] : '';
}

function selectedLesson(){
  return WATCH_STATE.lessons.find((lesson)=>String(lesson.id) === String(WATCH_STATE.selectedLessonId)) || WATCH_STATE.lessons[0] || null;
}

function selectedLikeContentId(){ return selectedLesson()?.id || ''; }

function mediaMarkup(){
  const lesson = selectedLesson();
  const youtubeUrl = lesson?.youtubeUrl || (!lesson ? WATCH_STATE.course.youtubeUrl : '');
  const videoUrl = lesson?.videoUrl || '';
  const ytId = youtubeId(youtubeUrl);
  if(ytId){
    return `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(ytId)}?rel=0&modestbranding=1&playsinline=1" title="${escapeHtml(lesson?.title || WATCH_STATE.course.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
  }
  if(videoUrl){
    return `<video src="${escapeHtml(videoUrl)}" controls playsinline preload="metadata" controlslist="nodownload" aria-label="${escapeHtml(lesson?.title || WATCH_STATE.course.title)}"></video>`;
  }
  if(lesson?.pdfUrl){
    return `<iframe src="${escapeHtml(lesson.pdfUrl)}" title="${escapeHtml(lesson.title)} PDF"></iframe>`;
  }
  if(lesson?.text){
    return `<div class="yt-watch-empty"><h2>${escapeHtml(lesson.title)}</h2><p>${escapeHtml(lesson.text)}</p></div>`;
  }
  if(WATCH_STATE.course.coverUrl){
    return `<img src="${escapeHtml(WATCH_STATE.course.coverUrl)}" alt="${escapeHtml(WATCH_STATE.course.title)}">`;
  }
  return '<div class="yt-watch-empty"><h2>Video dars</h2><p>Kursga qo‘shilgach video darslar shu yerda ochiladi.</p></div>';
}

function lessonThumb(lesson){
  const id = youtubeId(lesson.youtubeUrl);
  if(id) return `<img src="https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg" alt="">`;
  if(lesson.videoUrl) return '<span class="yt-play-glyph">▶</span>';
  if(lesson.pdfUrl) return '<span class="yt-play-glyph">PDF</span>';
  return '<span class="yt-play-glyph">Aa</span>';
}

function joinControls(){
  const course = WATCH_STATE.course;
  const role = String(WATCH_STATE.me?.role || 'student').toLowerCase();
  if(course.isOwner || role === 'admin') return `<a class="course-link-button primary" href="/course-studio.html?id=${encodeURIComponent(course.id)}">Kursni tahrirlash</a>`;
  if(course.viewer.joined) return '<span class="yt-joined-badge">✓ Kursga qo‘shilgansiz</span>';
  if(role !== 'student') return '';
  if(course.viewer.pendingRequest) return '<span class="yt-joined-badge">So‘rov yuborilgan</span>';
  if(course.joinMode === 'approval') return '<button class="course-button primary" id="requestJoinBtn">Kursga kirish so‘rovi</button>';
  return '<button class="course-button primary" id="joinCourseBtn">Kursga qo‘shilish</button>';
}

function renderWatch(){
  const course = WATCH_STATE.course;
  const lesson = selectedLesson();
  $('heroWrap').innerHTML = `
    <section class="yt-watch-layout">
      <div class="yt-watch-main">
        <div class="yt-watch-player">${mediaMarkup()}</div>
        <h1 class="yt-watch-title">${escapeHtml(lesson?.title || course.title)}</h1>
        <div class="yt-watch-actions">
          <div class="yt-watch-teacher"><div class="yt-teacher-avatar">${escapeHtml(String(course.teacherName || 'U').charAt(0).toUpperCase())}</div><div><b>${escapeHtml(course.teacherName || "O‘qituvchi")}</b><span>${course.enrolledCount || 0} talaba</span></div></div>
          <div class="yt-watch-action-buttons">
            ${joinControls()}
            <button class="yt-action-button ${WATCH_STATE.like.liked ? 'active' : ''}" id="videoLikeBtn" aria-pressed="${WATCH_STATE.like.liked ? 'true' : 'false'}">♥ <span>${WATCH_STATE.like.count || 0}</span></button>
            <button class="yt-action-button" id="shareCourseBtn">Ulashish</button>
          </div>
        </div>
        <div class="yt-watch-description">
          <div><b>${course.lessonCount || WATCH_STATE.lessons.length} dars</b> · ★ ${Number(course.ratingAverage || 0).toFixed(1)} · ${course.commentCount || 0} izoh</div>
          <p>${escapeHtml(course.description || 'Kurs tavsifi kiritilmagan.')}</p>
          ${lesson?.text ? `<p><b>Dars haqida:</b> ${escapeHtml(lesson.text)}</p>` : ''}
          <div class="yt-course-tags"><span>${course.type === 'paid' ? escapeHtml(money(course.price)) : 'Bepul'}</span><span>${escapeHtml(course.faculty || 'Barcha yo‘nalishlar')}</span><span>${escapeHtml(course.level || 'beginner')}</span></div>
        </div>
      </div>
      <aside class="yt-watch-playlist" aria-label="Kurs darslari">
        <header><div><b>Kurs tarkibi</b><span>${WATCH_STATE.lessons.length} dars</span></div><a href="/courses.html">Barcha kurslar</a></header>
        <div class="yt-playlist-items">
          ${WATCH_STATE.lessons.length ? WATCH_STATE.lessons.map((item, index)=>`
            <button class="yt-playlist-item ${String(item.id) === String(lesson?.id) ? 'active' : ''}" data-lesson-id="${escapeHtml(item.id)}">
              <span class="yt-playlist-order">${index + 1}</span><span class="yt-playlist-thumb">${lessonThumb(item)}</span>
              <span class="yt-playlist-copy"><b>${escapeHtml(item.title)}</b><small>${item.durationMinutes ? `${item.durationMinutes} daqiqa` : String(item.type || '').toUpperCase()}</small></span>
            </button>`).join('') : '<div class="course-empty">Darslar kursga qo‘shilgandan keyin ochiladi.</div>'}
        </div>
      </aside>
    </section>`;

  $('heroWrap').querySelectorAll('[data-lesson-id]').forEach((button)=>button.addEventListener('click', async ()=>{
    WATCH_STATE.selectedLessonId = button.dataset.lessonId || '';
    const url = new URL(location.href);
    url.searchParams.set('lesson', WATCH_STATE.selectedLessonId);
    history.replaceState({}, '', url);
    WATCH_STATE.like = { count: 0, liked: false };
    renderWatch();
    await loadLike();
  }));
  $('joinCourseBtn')?.addEventListener('click', joinCourse);
  $('requestJoinBtn')?.addEventListener('click', requestJoin);
  $('videoLikeBtn')?.addEventListener('click', toggleVideoLike);
  $('shareCourseBtn')?.addEventListener('click', shareCourse);
}

function commentTree(){
  const roots = WATCH_STATE.comments.filter((item)=>!item.parentId);
  const children = new Map();
  WATCH_STATE.comments.filter((item)=>item.parentId).forEach((item)=>{
    const list = children.get(String(item.parentId)) || [];
    list.push(item); children.set(String(item.parentId), list);
  });
  return { roots, children };
}

function commentItem(comment, children, depth = 0){
  const replies = depth === 0 ? (children.get(String(comment.id)) || []) : [];
  const teacher = ['teacher', 'admin'].includes(String(comment.authorRole || '').toLowerCase());
  return `<article class="yt-comment ${depth ? 'reply' : ''}">
    <div class="yt-comment-avatar">${escapeHtml(String(comment.authorName || 'F').charAt(0).toUpperCase())}</div>
    <div class="yt-comment-copy"><div><b>${escapeHtml(comment.authorName || 'Foydalanuvchi')}</b>${teacher ? '<span class="yt-author-badge">Ustoz</span>' : ''}<small>${escapeHtml(formatDate(comment.createdAt) || '')}</small></div>
    <p>${escapeHtml(comment.body || '')}</p>
    <div class="yt-comment-actions"><button data-comment-like="${escapeHtml(comment.id)}" class="${comment.liked ? 'active' : ''}" aria-pressed="${comment.liked ? 'true' : 'false'}">♥ ${comment.likeCount || 0}</button><button data-reply="${escapeHtml(comment.id)}">Javob</button></div>
    ${replies.map((reply)=>commentItem(reply, children, 1)).join('')}</div>
  </article>`;
}

function renderComments(){
  const course = WATCH_STATE.course;
  const role = String(WATCH_STATE.me?.role || 'student').toLowerCase();
  const canComment = course.allowComments && (role === 'admin' || course.isOwner || course.viewer.joined || course.visibility === 'public');
  const { roots, children } = commentTree();
  const target = WATCH_STATE.comments.find((item)=>String(item.id) === String(WATCH_STATE.replyParentId));
  $('commentsWrap').innerHTML = `<section class="yt-community">
    <h2>${WATCH_STATE.comments.length} ta izoh</h2>
    <div class="yt-comment-composer">
      <div class="yt-comment-avatar">${escapeHtml(String(WATCH_STATE.me?.fullName || WATCH_STATE.me?.nickname || 'S').charAt(0).toUpperCase())}</div>
      <div><textarea id="commentInput" ${canComment ? '' : 'disabled'} placeholder="${canComment ? 'Izoh yoki savol yozing…' : 'Izoh yozish uchun kursga qo‘shiling'}"></textarea>
      ${target ? `<div class="yt-replying">${escapeHtml(target.authorName || 'Foydalanuvchi')}ga javob <button id="clearReplyBtn">Bekor qilish</button></div>` : ''}
      <button class="course-button primary" id="sendCommentBtn" ${canComment ? '' : 'disabled'}>Yuborish</button></div>
    </div>
    <div class="yt-comments-list">${roots.length ? roots.map((comment)=>commentItem(comment, children)).join('') : '<div class="course-empty">Birinchi izohni siz yozing.</div>'}</div>
  </section>`;
  $('sendCommentBtn')?.addEventListener('click', saveComment);
  $('clearReplyBtn')?.addEventListener('click', ()=>{ WATCH_STATE.replyParentId = ''; renderComments(); });
  $('commentsWrap').querySelectorAll('[data-reply]').forEach((button)=>button.addEventListener('click', ()=>{
    WATCH_STATE.replyParentId = button.dataset.reply || ''; renderComments(); $('commentInput')?.focus();
  }));
  $('commentsWrap').querySelectorAll('[data-comment-like]').forEach((button)=>button.addEventListener('click', ()=>toggleCommentLike(button.dataset.commentLike)));
}

function renderRatings(){
  const canRate = WATCH_STATE.course.allowRatings && !WATCH_STATE.course.isOwner && (String(WATCH_STATE.me?.role || '') === 'admin' || WATCH_STATE.course.viewer.joined || WATCH_STATE.course.visibility === 'public');
  const mine = Number(WATCH_STATE.course.viewer.myRating || 0);
  $('ratingsWrap').innerHTML = `<section class="yt-rating-strip"><div><b>Kurs bahosi</b><strong>${Number(WATCH_STATE.ratingSummary.average || 0).toFixed(1)}</strong><span>${WATCH_STATE.ratingSummary.count || 0} baho</span></div>
    <div class="yt-rate-buttons">${[1,2,3,4,5].map((value)=>`<button data-rate="${value}" class="${value <= mine ? 'active' : ''}" ${canRate ? '' : 'disabled'} aria-label="${value} yulduz">★</button>`).join('')}<input id="ratingReviewInput" ${canRate ? '' : 'disabled'} placeholder="Qisqa fikr"><button id="saveRatingBtn" ${canRate ? '' : 'disabled'}>Saqlash</button></div></section>`;
  $('ratingsWrap').querySelectorAll('[data-rate]').forEach((button)=>button.addEventListener('click', ()=>{
    WATCH_STATE.course.viewer.myRating = Number(button.dataset.rate || 0); renderRatings();
  }));
  $('saveRatingBtn')?.addEventListener('click', saveRating);
}

async function loadLike(){
  const contentId = selectedLikeContentId();
  const query = contentId ? `?contentId=${encodeURIComponent(contentId)}` : '';
  try{
    const data = await apiFetch(`/api/courses/${encodeURIComponent(WATCH_STATE.course.id)}/likes${query}`);
    WATCH_STATE.like = { count: Number(data.count || 0), liked: !!data.liked };
  }catch(_){ WATCH_STATE.like = { count: 0, liked: false }; }
  renderWatch();
}

async function toggleVideoLike(){
  const data = await apiFetch(`/api/courses/${encodeURIComponent(WATCH_STATE.course.id)}/likes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentId: selectedLikeContentId() })
  });
  WATCH_STATE.like = { count: Number(data.count || 0), liked: !!data.liked };
  renderWatch();
}

async function toggleCommentLike(commentId){
  await apiFetch(`/api/courses/${encodeURIComponent(WATCH_STATE.course.id)}/comments/${encodeURIComponent(commentId)}/like`, { method: 'POST' });
  await loadComments();
}

async function saveComment(){
  const body = String($('commentInput')?.value || '').trim();
  if(!body) return showAlert('error', 'Izoh matnini yozing.');
  await apiFetch(`/api/courses/${encodeURIComponent(WATCH_STATE.course.id)}/comments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, parentId: WATCH_STATE.replyParentId || '' })
  });
  WATCH_STATE.replyParentId = '';
  await loadComments();
}

async function saveRating(){
  const rating = Number(WATCH_STATE.course.viewer.myRating || 0);
  if(!rating) return showAlert('error', 'Avval yulduz tanlang.');
  await apiFetch(`/api/courses/${encodeURIComponent(WATCH_STATE.course.id)}/ratings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating, reviewText: String($('ratingReviewInput')?.value || '') })
  });
  await loadRatings();
}

async function joinCourse(){
  await apiFetch(`/api/courses/${encodeURIComponent(WATCH_STATE.course.id)}/join`, { method: 'POST' });
  showAlert('success', 'Kursga qo‘shildingiz. Darslar ochildi.');
  await loadCourse();
}
async function requestJoin(){
  await apiFetch(`/api/courses/${encodeURIComponent(WATCH_STATE.course.id)}/requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '' })
  });
  showAlert('success', 'So‘rov o‘qituvchiga yuborildi.');
  await loadCourse();
}

async function shareCourse(){
  const payload = { title: WATCH_STATE.course.title, text: WATCH_STATE.course.description || '', url: location.href };
  if(navigator.share) return navigator.share(payload).catch(()=>{});
  await navigator.clipboard.writeText(location.href);
  showAlert('success', 'Kurs havolasi nusxalandi.');
}

async function loadLessons(){
  try{
    const data = await apiFetch(`/api/courses/${encodeURIComponent(WATCH_STATE.course.id)}/content`);
    WATCH_STATE.lessons = (Array.isArray(data?.items) ? data.items : []).map(normalizeLesson);
  }catch(_){ WATCH_STATE.lessons = []; }
  const requested = qs('lesson');
  WATCH_STATE.selectedLessonId = WATCH_STATE.lessons.some((item)=>String(item.id) === String(requested))
    ? requested : (WATCH_STATE.lessons.find((item)=>item.youtubeUrl || item.videoUrl)?.id || WATCH_STATE.lessons[0]?.id || '');
}

async function loadComments(){
  try{
    const data = await apiFetch(`/api/courses/${encodeURIComponent(WATCH_STATE.course.id)}/comments`);
    WATCH_STATE.comments = Array.isArray(data?.comments) ? data.comments : [];
  }catch(_){ WATCH_STATE.comments = []; }
  renderComments();
}

async function loadRatings(){
  try{
    const data = await apiFetch(`/api/courses/${encodeURIComponent(WATCH_STATE.course.id)}/ratings`);
    WATCH_STATE.ratings = Array.isArray(data?.ratings) ? data.ratings : [];
    WATCH_STATE.ratingSummary = data?.summary || { average: 0, count: 0 };
    WATCH_STATE.course.viewer.myRating = Number(data?.myRating || WATCH_STATE.course.viewer.myRating || 0);
  }catch(_){ WATCH_STATE.ratings = []; }
  renderRatings();
}

function recommendationThumb(course){
  if(course.coverUrl) return course.coverUrl;
  const id = youtubeId(course.previewMedia?.youtubeUrl || course.youtubeUrl || '');
  return id ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg` : '';
}

async function loadRecommendations(){
  const target = $('recommendationsWrap');
  try{
    const data = await apiFetch(`/api/courses/recommendations?limit=8&excludeCourseId=${encodeURIComponent(WATCH_STATE.course.id)}`);
    WATCH_STATE.recommendations = (Array.isArray(data?.courses) ? data.courses : []).map((raw)=>({
      ...normalizeCourse(raw),
      recommendationReason: raw.recommendationReason || ''
    }));
  }catch(_){ WATCH_STATE.recommendations = []; }
  if(!WATCH_STATE.recommendations.length){ target.innerHTML = ''; return; }
  target.innerHTML = `<section><div class="course-inline-actions" style="justify-content:space-between;margin-bottom:12px"><div><div class="course-eyebrow">Keyingi videolar</div><h2 class="course-section-title">Siz uchun tavsiya</h2></div><a class="course-link-button ghost" href="/courses.html">Barchasi</a></div><div class="yt-course-grid">${WATCH_STATE.recommendations.map((course)=>{
    const thumb = recommendationThumb(course);
    return `<article class="yt-course-card"><a class="yt-course-thumb" href="/course.html?id=${encodeURIComponent(course.id)}">${thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy">` : '<span class="yt-course-placeholder">H</span>'}<span class="yt-course-duration">${course.lessonCount || 0} dars</span></a><div class="yt-course-info"><div class="yt-teacher-avatar">${escapeHtml(String(course.teacherName || 'U').charAt(0).toUpperCase())}</div><div class="yt-course-copy"><a class="yt-course-title" href="/course.html?id=${encodeURIComponent(course.id)}">${escapeHtml(course.title)}</a><div class="yt-course-teacher">${escapeHtml(course.teacherName || 'O‘qituvchi')}</div><div class="yt-course-meta">${course.likeCount || 0} yoqdi · ${course.commentCount || 0} izoh · ★ ${Number(course.ratingAverage || 0).toFixed(1)}</div><div class="yt-course-tags"><span>${escapeHtml(course.recommendationReason || 'Siz uchun')}</span></div></div></div></article>`;
  }).join('')}</div></section>`;
}

async function loadCourse(){
  const id = qs('id');
  if(!id) throw new Error('Kurs ID topilmadi.');
  const data = await apiFetch(`/api/courses/${encodeURIComponent(id)}`);
  WATCH_STATE.course = normalizeCourse(data?.course || data);
  await loadLessons();
  renderWatch();
  await Promise.all([loadLike(), loadComments(), loadRatings()]);
}

async function init(){
  initStoredTheme(); applyTheme($('themeBtn')); $('logoutBtn').addEventListener('click', logout);
  WATCH_STATE.me = await getMe();
  if(!WATCH_STATE.me) return;
  renderHeaderMeta(WATCH_STATE.me, { roleBadge: 'roleBadge', mePill: 'mePill', dashboardLink: 'dashboardLink' });
  await loadCourse();
  await loadRecommendations();
}

init().catch((error)=>showAlert('error', error.message || 'Kurs yuklanmadi.'));
