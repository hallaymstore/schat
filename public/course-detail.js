const {
  $, qs, apiFetch, getMe, initStoredTheme, applyTheme, renderHeaderMeta, logout,
  iconSpan, normalizeCourse, normalizeLesson, escapeHtml, money, shortText,
  formatDate, mediaForCourse, mediaForLesson
} = window.CourseSuite;

const COURSE_DETAIL_STATE = {
  me: null,
  course: null,
  ratings: [],
  ratingSummary: { average: 0, count: 0, distribution: { 1:0, 2:0, 3:0, 4:0, 5:0 } },
  comments: [],
  lessons: [],
  replyParentId: ""
};

function showAlert(type, message){
  const box = $("pageAlert");
  box.className = "course-alert show " + (type === "error" ? "error" : "success");
  box.textContent = message;
}

function clearAlert(){
  $("pageAlert").className = "course-alert";
  $("pageAlert").textContent = "";
}

function mediaHtml(media){
  if(media.type === "embed") return `<div class="course-media"><iframe src="${escapeHtml(media.src)}" allowfullscreen></iframe></div>`;
  if(media.type === "video") return `<div class="course-media"><video src="${escapeHtml(media.src)}" controls playsinline preload="metadata"></video></div>`;
  if(media.type === "image") return `<div class="course-media"><img src="${escapeHtml(media.src)}" alt="course preview"></div>`;
  return `<div class="course-media placeholder"><div><div style="font-size:12px;opacity:.72;letter-spacing:.18em;text-transform:uppercase">HALLAYM Course</div><div style="font-size:2rem;font-weight:900;margin-top:10px">Jonli videodars, PDF va testlar</div></div></div>`;
}

function buildStars(activeValue, clickable){
  const stars = [];
  for(let value = 1; value <= 5; value += 1){
    const cls = value <= activeValue ? "course-star-button active" : "course-star-button";
    const attrs = clickable ? `data-rate="${value}" type="button"` : "";
    stars.push(`<button class="${cls}" ${attrs}>${iconSpan("star")}</button>`);
  }
  return stars.join("");
}

function commentTree(){
  const roots = COURSE_DETAIL_STATE.comments.filter((item)=> !item.parentId);
  const childrenMap = new Map();
  COURSE_DETAIL_STATE.comments.filter((item)=> item.parentId).forEach((item)=>{
    const key = String(item.parentId);
    const list = childrenMap.get(key) || [];
    list.push(item);
    childrenMap.set(key, list);
  });
  return { roots, childrenMap };
}

function renderCommentItem(comment, childrenMap){
  const isTeacher = comment.authorRole === "teacher" || comment.authorRole === "admin";
  const replyLabel = isTeacher ? "Ustoz" : "Talaba";
  const replies = childrenMap.get(String(comment.id)) || [];
  return `
    <article class="course-comment">
      <div class="course-comment-header">
        <div>
          <div class="course-chip-row">
            <span class="course-tag ${isTeacher ? "accent" : ""}">${escapeHtml(replyLabel)}</span>
            <span class="course-inline-code">${escapeHtml(comment.authorName || "Foydalanuvchi")}</span>
          </div>
          <div class="course-muted" style="margin-top:8px">${escapeHtml(formatDate(comment.createdAt) || "")}</div>
        </div>
        <button class="course-button ghost" type="button" data-reply="${escapeHtml(comment.id)}">${iconSpan("message")}Javob</button>
      </div>
      <div class="course-comment-body">${escapeHtml(comment.body || "")}</div>
      ${replies.map((reply)=> `
        <div class="course-comment reply">
          <div class="course-comment-header">
            <div>
              <div class="course-chip-row">
                <span class="course-tag ${reply.authorRole === "teacher" || reply.authorRole === "admin" ? "accent" : ""}">${escapeHtml(reply.authorRole === "teacher" || reply.authorRole === "admin" ? "Ustoz javobi" : "Javob")}</span>
                <span class="course-inline-code">${escapeHtml(reply.authorName || "Foydalanuvchi")}</span>
              </div>
              <div class="course-muted" style="margin-top:8px">${escapeHtml(formatDate(reply.createdAt) || "")}</div>
            </div>
          </div>
          <div class="course-comment-body">${escapeHtml(reply.body || "")}</div>
        </div>
      `).join("")}
    </article>
  `;
}

function renderHero(){
  const course = COURSE_DETAIL_STATE.course;
  const me = COURSE_DETAIL_STATE.me;
  const role = String(me.role || "student").toLowerCase();
  const canManage = role === "admin" || course.isOwner;
  const joined = !!course.viewer.joined;
  const pending = !!course.viewer.pendingRequest;
  const joinModeLabel = course.joinMode === "approval" ? "Ustoz tasdig'i bilan qo'shilish" : "Darhol qo'shilish";
  const media = mediaForCourse(course);

  $("heroWrap").innerHTML = `
    <section class="course-card">
      <div class="course-hero">
        <div class="course-hero-copy">
          <div class="course-eyebrow">${iconSpan("course")}Premium kurs sahifasi</div>
          <h1 class="course-big-title">${escapeHtml(course.title)}</h1>
          <p class="course-section-copy">${escapeHtml(course.description || "Bu kursda videodarslar, PDF materiallar, qisqa testlar va progress kuzatuvi mavjud.")}</p>
          <div class="course-chip-row">
            <span class="course-badge ${course.type === "paid" ? "warn" : "success"}">${course.type === "paid" ? escapeHtml(money(course.price)) : "Bepul"}</span>
            <span class="course-badge">${escapeHtml(course.faculty || "Fakultet belgilanmagan")}</span>
            <span class="course-badge">${escapeHtml(joinModeLabel)}</span>
            <span class="course-badge">${course.lessonCount || 0} mavzu</span>
          </div>
          <div class="course-stat-grid">
            <div class="course-stat">
              <div class="course-muted">O'qituvchi</div>
              <div class="course-stat-value">${escapeHtml(course.teacherName || "Ustoz")}</div>
            </div>
            <div class="course-stat">
              <div class="course-muted">Reyting</div>
              <div class="course-stat-value">${course.ratingAverage ? course.ratingAverage.toFixed(1) : "0.0"}</div>
            </div>
            <div class="course-stat">
              <div class="course-muted">Komment</div>
              <div class="course-stat-value">${course.commentCount || 0}</div>
            </div>
            <div class="course-stat">
              <div class="course-muted">Qo'shilish rejimi</div>
              <div class="course-stat-value" style="font-size:1rem">${course.joinMode === "approval" ? "So'rov" : "Ochiq"}</div>
            </div>
          </div>
          <div class="course-inline-actions">
            ${joined ? `<a class="course-link-button primary" href="/joinedcourse.html?id=${encodeURIComponent(course.id)}">${iconSpan("play")}Kursni boshlash</a>` : ""}
            ${role === "student" && !joined && course.joinMode === "open" ? `<button class="course-button primary" id="joinCourseBtn">${iconSpan("users")}Kursga qo'shilish</button>` : ""}
            ${role === "student" && !joined && course.joinMode === "approval" ? `<button class="course-button primary" id="requestJoinBtn">${iconSpan("send")}So'rov yuborish</button>` : ""}
            ${canManage ? `<a class="course-link-button primary" href="/joinedcourse.html?id=${encodeURIComponent(course.id)}">${iconSpan("play")}Ichiga kirish</a>` : ""}
            ${canManage ? `<a class="course-link-button secondary" href="/course-studio.html?id=${encodeURIComponent(course.id)}">${iconSpan("settings")}Studio</a>` : ""}
            ${canManage ? `<a class="course-link-button secondary" href="/course-progress.html?id=${encodeURIComponent(course.id)}">${iconSpan("chart")}Natijalar</a>` : ""}
          </div>
          <div class="course-surface-note">
            ${joined
              ? "Siz bu kursga qo'shilgansiz. Mavzularni ketma-ket o'tib, qisqa testlarni ishlashingiz mumkin."
              : pending
                ? "So'rovingiz yuborilgan. Ustoz tasdiqlashi bilan kurs ochiladi."
                : course.joinMode === "approval"
                  ? "Bu kursga kirish uchun ustoz tasdig'i kerak. Xohlasangiz qisqa izoh bilan so'rov yuboring."
                  : "Bu kurs darhol qo'shilish uchun ochiq. Qo'shilganingizdan keyin videodars, PDF va testlar bir joyda ochiladi."}
          </div>
          ${role === "student" && !joined && course.joinMode === "approval" ? `
            <div class="course-form-group">
              <label for="joinRequestMessage">Ustozga izoh</label>
              <textarea id="joinRequestMessage" class="course-textarea" placeholder="Masalan, guruhim shu fan bo'yicha o'qiydi va kursga qo'shilmoqchiman."></textarea>
            </div>
          ` : ""}
        </div>
        <div>
          ${mediaHtml(media)}
          <div class="course-card tight section-gap">
            <div class="course-section-title">Kurs tafsilotlari</div>
            <div class="course-stack" style="margin-top:14px">
              <div class="course-row-card compact">
                <div class="course-row-main">
                  <div class="course-muted">Guruhlar</div>
                  <div style="font-weight:800;margin-top:6px">${escapeHtml((course.groups && course.groups.length) ? course.groups.join(", ") : "Barcha mos talabalar uchun")}</div>
                </div>
              </div>
              <div class="course-row-card compact">
                <div class="course-row-main">
                  <div class="course-muted">Tavsiyalar</div>
                  <div style="font-weight:800;margin-top:6px">${escapeHtml(shortText(course.outcomes || "Videodarslarni ko'ring, PDFni oching, har mavzudan keyin test ishlang va progressni kuzating.", 160))}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;

  if($("joinCourseBtn")){
    $("joinCourseBtn").addEventListener("click", joinCourse);
  }
  if($("requestJoinBtn")){
    $("requestJoinBtn").addEventListener("click", requestJoin);
  }
}

function renderRatings(){
  const course = COURSE_DETAIL_STATE.course;
  const role = String(COURSE_DETAIL_STATE.me.role || "student").toLowerCase();
  const canRate = course.allowRatings && !course.isOwner && (role === "admin" || course.viewer.joined);
  const summary = COURSE_DETAIL_STATE.ratingSummary;

  $("ratingsWrap").innerHTML = `
    <section class="course-card">
      <div class="course-split">
        <div>
          <h2 class="course-section-title">Baholar</h2>
          <p class="course-section-copy">Talabalar kursni 1 dan 5 gacha baholaydi. Ustoz yangi baholar haqida bildirishnoma oladi.</p>
          <div class="course-summary-grid" style="margin-top:18px">
            <div class="course-summary">
              <div class="course-muted">O'rtacha baho</div>
              <div class="course-summary-value">${summary.average ? Number(summary.average).toFixed(1) : "0.0"}</div>
            </div>
            <div class="course-summary">
              <div class="course-muted">Jami baho</div>
              <div class="course-summary-value">${summary.count || 0}</div>
            </div>
          </div>
          <div class="course-stack" style="margin-top:18px">
            ${[5,4,3,2,1].map((star)=> `
              <div class="course-row-card compact">
                <div class="course-row-main">
                  <div class="course-muted">${star} yulduz</div>
                  <div class="course-progress-bar" style="margin-top:8px"><span style="width:${summary.count ? Math.round(((summary.distribution[star] || 0) / summary.count) * 100) : 0}%"></span></div>
                </div>
                <strong>${summary.distribution[star] || 0}</strong>
              </div>
            `).join("")}
          </div>
        </div>
        <div class="course-card tight">
          <div class="course-section-title">Sizning bahoyingiz</div>
          <div class="course-muted" style="margin-top:8px">${canRate ? "Kurs sizga yoqsa yulduz va qisqa izoh qoldiring." : "Baholash faqat kursga qo'shilgan talabalar uchun ochiladi."}</div>
          <div class="course-rating-stars" id="ratingStars" style="margin-top:18px">${buildStars(COURSE_DETAIL_STATE.course.viewer.myRating, canRate)}</div>
          <div class="course-form-group" style="margin-top:16px">
            <label for="ratingReviewInput">Qisqa fikr</label>
            <textarea id="ratingReviewInput" class="course-textarea" ${canRate ? "" : "disabled"} placeholder="Nimasi foydali bo'ldi?">${escapeHtml((COURSE_DETAIL_STATE.ratings.find((item)=> String(item.userId || "") === String(COURSE_DETAIL_STATE.me._id || ""))?.reviewText) || "")}</textarea>
          </div>
          <button class="course-button primary" id="saveRatingBtn" ${canRate ? "" : "disabled"} style="margin-top:16px">${iconSpan("star")}Bahoni saqlash</button>
        </div>
      </div>
      <div class="course-stack" style="margin-top:18px">
        ${(COURSE_DETAIL_STATE.ratings || []).length ? COURSE_DETAIL_STATE.ratings.slice(0, 8).map((rating)=> `
          <article class="course-row-card compact">
            <div class="course-row-main">
              <div class="course-chip-row">
                <span class="course-inline-code">${escapeHtml(rating.authorName || "Talaba")}</span>
                <span class="course-inline-code">${escapeHtml(formatDate(rating.createdAt) || "")}</span>
              </div>
              <div class="course-rating-stars" style="margin-top:10px">${buildStars(Number(rating.rating || 0), false)}</div>
              <div class="course-row-copy" style="margin-top:10px">${escapeHtml(rating.reviewText || "Izoh qoldirilmagan.")}</div>
            </div>
          </article>
        `).join("") : `<div class="course-empty">Hozircha baho qoldirilmagan.</div>`}
      </div>
    </section>
  `;

  if(canRate){
    $("ratingStars").querySelectorAll("[data-rate]").forEach((button)=>{
      button.addEventListener("click", ()=>{
        COURSE_DETAIL_STATE.course.viewer.myRating = Number(button.dataset.rate || 0);
        renderRatings();
      });
    });
    $("saveRatingBtn").addEventListener("click", saveRating);
  }
}

function renderComments(){
  const course = COURSE_DETAIL_STATE.course;
  const role = String(COURSE_DETAIL_STATE.me.role || "student").toLowerCase();
  const canComment = course.allowComments && (role === "admin" || course.isOwner || course.viewer.joined);
  const { roots, childrenMap } = commentTree();
  const replyTarget = COURSE_DETAIL_STATE.replyParentId;
  const replyComment = COURSE_DETAIL_STATE.comments.find((item)=> String(item.id) === String(replyTarget));

  $("commentsWrap").innerHTML = `
    <section class="course-card">
      <div class="course-split">
        <div>
          <h2 class="course-section-title">Kommentlar va savollar</h2>
          <p class="course-section-copy">Talabalar savol qoldiradi, kurs egasi esa shu yerning o'zida javob qaytaradi. Har yangi komment ustozga bildiriladi.</p>
          <div class="course-stack" style="margin-top:18px">
            ${roots.length ? roots.map((comment)=> renderCommentItem(comment, childrenMap)).join("") : `<div class="course-empty">Kommentlar hali boshlanmagan.</div>`}
          </div>
        </div>
        <div class="course-card tight">
          <div class="course-section-title">Yangi komment</div>
          <div class="course-muted" style="margin-top:8px">${canComment ? "Kurs bo'yicha savol, fikr yoki javob yozishingiz mumkin." : "Komment yozish kursga qo'shilgan talabalar va ustoz uchun ochiq."}</div>
          <div class="course-surface-note" id="replyHint" style="margin-top:16px;display:${replyComment ? "block" : "none"}">
            ${replyComment ? `Javob yozilyapti: ${escapeHtml(replyComment.authorName || "Foydalanuvchi")}` : ""}
          </div>
          <div class="course-form-group" style="margin-top:16px">
            <label for="commentInput">Matn</label>
            <textarea id="commentInput" class="course-textarea" ${canComment ? "" : "disabled"} placeholder="Savol yoki fikringizni yozing..."></textarea>
          </div>
          <div class="course-inline-actions" style="margin-top:16px">
            <button class="course-button primary" id="sendCommentBtn" ${canComment ? "" : "disabled"}>${iconSpan("send")}Yuborish</button>
            <button class="course-button ghost" id="clearReplyBtn" ${replyTarget ? "" : "style='display:none'"}>${iconSpan("trash")}Replyni bekor qilish</button>
          </div>
        </div>
      </div>
    </section>
  `;

  if(canComment){
    $("sendCommentBtn").addEventListener("click", saveComment);
  }
  const clearReplyBtn = $("clearReplyBtn");
  if(clearReplyBtn){
    clearReplyBtn.addEventListener("click", ()=>{
      COURSE_DETAIL_STATE.replyParentId = "";
      renderComments();
    });
  }
  $("commentsWrap").querySelectorAll("[data-reply]").forEach((button)=>{
    button.addEventListener("click", ()=>{
      COURSE_DETAIL_STATE.replyParentId = button.dataset.reply || "";
      renderComments();
    });
  });
}

function renderLessons(){
  const list = COURSE_DETAIL_STATE.lessons || [];
  const canAccessLessons = !!list.length;
  $("lessonsWrap").innerHTML = `
    <section class="course-card">
      <div class="course-split">
        <div>
          <h2 class="course-section-title">Mavzular va materiallar</h2>
          <p class="course-section-copy">Har bir mavzuda video yoki PDF material bo'ladi. Ustoz xohlasa mavzu oxiriga qisqa test ham biriktiradi.</p>
        </div>
        <div class="course-card tight">
          <div class="course-section-title">Tez ko'rinish</div>
          <div class="course-muted" style="margin-top:8px">${canAccessLessons ? "Kurs tarkibi allaqachon tayyor. Quyida mavzular ko'rsatilgan." : "Mavzularni ko'rish kursga qo'shilgandan keyin yoki studio orqali ochiladi."}</div>
        </div>
      </div>
      <div class="course-stack" style="margin-top:18px">
        ${canAccessLessons ? list.map((lesson, index)=> {
          const media = mediaForLesson(lesson);
          return `
            <article class="course-row-card">
              <div class="course-row-main">
                <div class="course-chip-row">
                  <span class="course-tag">${index + 1}-mavzu</span>
                  <span class="course-tag">${escapeHtml(String(lesson.type || "").toUpperCase())}</span>
                  ${lesson.quizEnabled ? `<span class="course-tag accent">Qisqa test bor</span>` : ""}
                  ${lesson.isPreview ? `<span class="course-tag warn">Preview</span>` : ""}
                </div>
                <h3 class="course-row-title" style="margin-top:12px">${escapeHtml(lesson.title)}</h3>
                <p class="course-row-copy">${escapeHtml(shortText(lesson.text || "Video yoki PDF material orqali tushuntiriladi.", 180))}</p>
                <div class="course-meta-row" style="margin-top:10px">
                  <span class="course-inline-code">${lesson.durationMinutes ? lesson.durationMinutes + " min" : "Davomiylik kiritilmagan"}</span>
                  <span class="course-inline-code">${lesson.materials.length} material</span>
                </div>
              </div>
              <div class="course-thumb">${media.type === "image" ? `<img src="${escapeHtml(media.src)}" alt="preview">` : ""}</div>
            </article>
          `;
        }).join("") : `<div class="course-empty">Mavzularni ko'rish uchun kursga qo'shiling yoki teacher studio orqali oching.</div>`}
      </div>
    </section>
  `;
}

async function saveRating(){
  try{
    clearAlert();
    const rating = Number(COURSE_DETAIL_STATE.course.viewer.myRating || 0);
    if(!rating){
      showAlert("error", "Avval yulduz tanlang.");
      return;
    }
    await apiFetch(`/api/courses/${encodeURIComponent(COURSE_DETAIL_STATE.course.id)}/ratings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rating,
        reviewText: $("ratingReviewInput").value
      })
    });
    showAlert("success", "Bahoyingiz saqlandi.");
    await loadEngagement();
  }catch(error){
    showAlert("error", error.message || "Baho saqlanmadi.");
  }
}

async function saveComment(){
  try{
    clearAlert();
    await apiFetch(`/api/courses/${encodeURIComponent(COURSE_DETAIL_STATE.course.id)}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: $("commentInput").value,
        parentId: COURSE_DETAIL_STATE.replyParentId || ""
      })
    });
    $("commentInput").value = "";
    COURSE_DETAIL_STATE.replyParentId = "";
    showAlert("success", "Komment yuborildi.");
    await loadComments();
  }catch(error){
    showAlert("error", error.message || "Komment yuborilmadi.");
  }
}

async function joinCourse(){
  try{
    clearAlert();
    await apiFetch(`/api/courses/${encodeURIComponent(COURSE_DETAIL_STATE.course.id)}/join`, { method: "POST" });
    showAlert("success", "Kursga qo'shildingiz.");
    await loadCourse();
  }catch(error){
    showAlert("error", error.message || "Kursga qo'shilib bo'lmadi.");
  }
}

async function requestJoin(){
  try{
    clearAlert();
    await apiFetch(`/api/courses/${encodeURIComponent(COURSE_DETAIL_STATE.course.id)}/requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: $("joinRequestMessage")?.value || "" })
    });
    showAlert("success", "So'rov yuborildi.");
    await loadCourse();
  }catch(error){
    showAlert("error", error.message || "So'rov yuborilmadi.");
  }
}

async function loadLessons(){
  try{
    const data = await apiFetch(`/api/courses/${encodeURIComponent(COURSE_DETAIL_STATE.course.id)}/content`);
    COURSE_DETAIL_STATE.lessons = (Array.isArray(data?.items) ? data.items : []).map(normalizeLesson);
  }catch(_){
    COURSE_DETAIL_STATE.lessons = [];
  }
  renderLessons();
}

async function loadComments(){
  try{
    const data = await apiFetch(`/api/courses/${encodeURIComponent(COURSE_DETAIL_STATE.course.id)}/comments`);
    COURSE_DETAIL_STATE.comments = Array.isArray(data?.comments) ? data.comments : [];
  }catch(_){
    COURSE_DETAIL_STATE.comments = [];
  }
  renderComments();
}

async function loadEngagement(){
  try{
    const data = await apiFetch(`/api/courses/${encodeURIComponent(COURSE_DETAIL_STATE.course.id)}/ratings`);
    COURSE_DETAIL_STATE.ratings = Array.isArray(data?.ratings) ? data.ratings : [];
    COURSE_DETAIL_STATE.ratingSummary = data?.summary || COURSE_DETAIL_STATE.ratingSummary;
    COURSE_DETAIL_STATE.course.viewer.myRating = Number(data?.myRating || COURSE_DETAIL_STATE.course.viewer.myRating || 0);
  }catch(_){
    COURSE_DETAIL_STATE.ratings = [];
  }
  renderRatings();
}

async function loadCourse(){
  const courseId = qs("id");
  if(!courseId){
    showAlert("error", "Kurs ID topilmadi.");
    return;
  }
  const data = await apiFetch("/api/courses/" + encodeURIComponent(courseId));
  COURSE_DETAIL_STATE.course = normalizeCourse(data?.course || data);
  renderHero();
  await Promise.all([loadEngagement(), loadComments(), loadLessons()]);
}

async function init(){
  initStoredTheme();
  applyTheme($("themeBtn"));
  $("logoutBtn").addEventListener("click", logout);
  COURSE_DETAIL_STATE.me = await getMe();
  if(!COURSE_DETAIL_STATE.me) return;
  renderHeaderMeta(COURSE_DETAIL_STATE.me, { roleBadge: "roleBadge", mePill: "mePill", dashboardLink: "dashboardLink" });
  await loadCourse();
}

init().catch((error)=>{
  showAlert("error", error.message || "Sahifa yuklanmadi.");
});
