const {
  $, qs, apiFetch, getMe, initStoredTheme, applyTheme, renderHeaderMeta, logout,
  iconSpan, normalizeCourse, escapeHtml, formatDate, money
} = window.CourseSuite;

const PROGRESS_STATE = {
  me: null,
  course: null,
  analytics: null
};

function progressAlert(type, message){
  const box = $("pageAlert");
  box.className = "course-alert show " + (type === "error" ? "error" : "success");
  box.textContent = message;
}

function renderAnalytics(){
  const analytics = PROGRESS_STATE.analytics;
  const course = PROGRESS_STATE.course;
  $("progressHero").innerHTML = `
    <section class="course-card">
      <div class="course-split">
        <div>
          <div class="course-eyebrow">${iconSpan("chart")}Teacher analytics</div>
          <h1 class="course-big-title" style="font-size:clamp(2rem, 1.3rem + 2vw, 3.6rem)">${escapeHtml(course.title)}</h1>
          <p class="course-section-copy">Kursga qo'shilgan talabalar, join requestlar, quiz natijalari, baholar va kommentlar shu sahifada jamlangan.</p>
          <div class="course-inline-actions">
            <a class="course-link-button" href="/course.html?id=${encodeURIComponent(course.id)}">${iconSpan("eye")}Kurs sahifasi</a>
            <a class="course-link-button" href="/course-studio.html?id=${encodeURIComponent(course.id)}">${iconSpan("settings")}Studio</a>
            <button class="course-button primary" id="refreshAnalyticsBtn">${iconSpan("check")}Yangilash</button>
          </div>
        </div>
        <div class="course-summary-grid">
          <div class="course-summary"><div class="course-muted">Talabalar</div><div class="course-summary-value">${analytics.summary.enrolledCount || 0}</div></div>
          <div class="course-summary"><div class="course-muted">Pending</div><div class="course-summary-value">${analytics.summary.pendingRequests || 0}</div></div>
          <div class="course-summary"><div class="course-muted">O'rtacha progress</div><div class="course-summary-value">${analytics.summary.averageProgress || 0}%</div></div>
          <div class="course-summary"><div class="course-muted">Reyting</div><div class="course-summary-value">${analytics.summary.averageRating || 0}</div></div>
        </div>
      </div>
    </section>
  `;

  $("refreshAnalyticsBtn").addEventListener("click", loadAnalytics);

  $("summaryCards").innerHTML = `
    <div class="course-kpi-grid">
      <div class="course-kpi"><div class="course-muted">Mavzular</div><div class="course-kpi-value">${analytics.summary.totalLessons || 0}</div></div>
      <div class="course-kpi"><div class="course-muted">Quizli mavzular</div><div class="course-kpi-value">${analytics.summary.quizLessonCount || 0}</div></div>
      <div class="course-kpi"><div class="course-muted">Kommentlar</div><div class="course-kpi-value">${analytics.summary.commentCount || 0}</div></div>
      <div class="course-kpi"><div class="course-muted">Bajarish darajasi</div><div class="course-kpi-value">${analytics.summary.completionRate || 0}%</div></div>
    </div>
  `;

  $("requestsWrap").innerHTML = analytics.requests.length ? analytics.requests.map((request)=> `
    <article class="course-row-card">
      <div class="course-row-main">
        <div class="course-chip-row">
          <span class="course-tag ${request.status === "pending" ? "warn" : request.status === "approved" ? "success" : "danger"}">${escapeHtml(request.status)}</span>
          <span class="course-inline-code">${escapeHtml(request.fullName || "Talaba")}</span>
          <span class="course-inline-code">${escapeHtml(request.group || "Guruh yo'q")}</span>
        </div>
        <div class="course-row-copy" style="margin-top:10px">${escapeHtml(request.message || "Izoh qoldirilmagan.")}</div>
        <div class="course-muted" style="margin-top:8px">Yuborilgan: ${escapeHtml(formatDate(request.createdAt) || "")}</div>
      </div>
      <div class="course-inline-actions">
        ${request.status === "pending" ? `<button class="course-button primary" data-review="approved" data-request="${escapeHtml(request.id)}">${iconSpan("check")}Tasdiqlash</button>` : ""}
        ${request.status === "pending" ? `<button class="course-button danger" data-review="rejected" data-request="${escapeHtml(request.id)}">${iconSpan("trash")}Rad etish</button>` : ""}
      </div>
    </article>
  `).join("") : `<div class="course-empty">Kursga qo'shilish so'rovlari hozircha yo'q.</div>`;

  $("requestsWrap").querySelectorAll("[data-review]").forEach((button)=>{
    button.addEventListener("click", ()=> reviewRequest(button.dataset.request, button.dataset.review));
  });

  $("studentsWrap").innerHTML = analytics.students.length ? `
    <div class="course-card tight">
      <table class="course-table">
        <thead>
          <tr>
            <th>Talaba</th>
            <th>Guruh</th>
            <th>Progress</th>
            <th>Quizlar</th>
            <th>Oxirgi faollik</th>
            <th>To'lov</th>
          </tr>
        </thead>
        <tbody>
          ${analytics.students.map((student)=> `
            <tr>
              <td>
                <strong>${escapeHtml(student.fullName || "Talaba")}</strong>
                <div class="course-muted">${escapeHtml(student.faculty || "")}</div>
              </td>
              <td>${escapeHtml(student.group || "—")}</td>
              <td>
                <div>${student.progressPercent || 0}%</div>
                <div class="course-muted">${student.doneCount || 0}/${student.totalLessons || 0}</div>
              </td>
              <td>
                <div>${student.quizPassedCount || 0} o'tdi</div>
                <div class="course-muted">${student.quizAttemptCount || 0} urinish</div>
              </td>
              <td>${escapeHtml(formatDate(student.lastActivityAt) || "—")}</td>
              <td>${escapeHtml(money(student.paidAmount || 0))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  ` : `<div class="course-empty">Hali biror talaba qo'shilmagan.</div>`;

  $("lessonStatsWrap").innerHTML = analytics.lessonStats.length ? analytics.lessonStats.map((lesson)=> `
    <article class="course-row-card">
      <div class="course-row-main">
        <div class="course-chip-row">
          <span class="course-tag">${escapeHtml(String(lesson.type || "").toUpperCase())}</span>
          ${lesson.quizEnabled ? `<span class="course-tag accent">Quiz</span>` : ""}
        </div>
        <h3 class="course-row-title" style="margin-top:10px">${escapeHtml(lesson.title || "Mavzu")}</h3>
        <div class="course-summary-grid" style="margin-top:12px">
          <div class="course-summary"><div class="course-muted">Tugatdi</div><div class="course-summary-value">${lesson.completedUsers || 0}</div></div>
          <div class="course-summary"><div class="course-muted">Quiz urinish</div><div class="course-summary-value">${lesson.quizAttempts || 0}</div></div>
          <div class="course-summary"><div class="course-muted">Quiz o'tgan</div><div class="course-summary-value">${lesson.quizPassedUsers || 0}</div></div>
          <div class="course-summary"><div class="course-muted">Avg score</div><div class="course-summary-value">${lesson.avgBestScore || 0}</div></div>
        </div>
      </div>
    </article>
  `).join("") : `<div class="course-empty">Mavzular bo'yicha statistika tayyor emas.</div>`;

  $("feedbackWrap").innerHTML = `
    <div class="course-grid">
      <div class="course-col-6">
        <div class="course-card tight">
          <h2 class="course-section-title">Baholar</h2>
          <div class="course-stack" style="margin-top:16px">
            ${analytics.ratings.length ? analytics.ratings.map((rating)=> `
              <article class="course-row-card compact">
                <div class="course-row-main">
                  <div class="course-chip-row">
                    <span class="course-tag warn">${rating.rating} yulduz</span>
                    <span class="course-inline-code">${escapeHtml(rating.authorName || "Talaba")}</span>
                  </div>
                  <div class="course-row-copy" style="margin-top:10px">${escapeHtml(rating.reviewText || "Izoh qoldirilmagan.")}</div>
                </div>
              </article>
            `).join("") : `<div class="course-empty">Baholar hali yo'q.</div>`}
          </div>
        </div>
      </div>
      <div class="course-col-6">
        <div class="course-card tight">
          <h2 class="course-section-title">Kommentlar</h2>
          <div class="course-stack" style="margin-top:16px">
            ${analytics.comments.length ? analytics.comments.map((comment)=> `
              <article class="course-row-card compact">
                <div class="course-row-main">
                  <div class="course-chip-row">
                    <span class="course-tag ${comment.authorRole === "teacher" || comment.authorRole === "admin" ? "accent" : ""}">${escapeHtml(comment.authorRole || "student")}</span>
                    <span class="course-inline-code">${escapeHtml(comment.authorName || "Foydalanuvchi")}</span>
                  </div>
                  <div class="course-row-copy" style="margin-top:10px">${escapeHtml(comment.body || "")}</div>
                </div>
              </article>
            `).join("") : `<div class="course-empty">Kommentlar hali yo'q.</div>`}
          </div>
        </div>
      </div>
    </div>
  `;
}

async function reviewRequest(requestId, status){
  try{
    const reviewNote = window.prompt(status === "approved" ? "Tasdiqlash izohi (ixtiyoriy):" : "Rad etish sababi (ixtiyoriy):", "") || "";
    await apiFetch(`/api/courses/${encodeURIComponent(PROGRESS_STATE.course.id)}/requests/${encodeURIComponent(requestId)}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, reviewNote })
    });
    progressAlert("success", status === "approved" ? "So'rov tasdiqlandi." : "So'rov rad etildi.");
    await loadAnalytics();
  }catch(error){
    progressAlert("error", error.message || "So'rov ko'rib chiqilmadi.");
  }
}

async function loadAnalytics(){
  const courseId = qs("id");
  if(!courseId){
    progressAlert("error", "Kurs ID topilmadi.");
    return;
  }
  const data = await apiFetch(`/api/courses/${encodeURIComponent(courseId)}/analytics`);
  PROGRESS_STATE.analytics = data;
  PROGRESS_STATE.course = normalizeCourse(data.course || {});
  renderAnalytics();
}

async function init(){
  initStoredTheme();
  applyTheme($("themeBtn"));
  $("logoutBtn").addEventListener("click", logout);
  PROGRESS_STATE.me = await getMe();
  if(!PROGRESS_STATE.me) return;
  if(!["teacher", "admin"].includes(String(PROGRESS_STATE.me.role || "").toLowerCase())){
    progressAlert("error", "Bu sahifa teacher yoki admin uchun.");
    return;
  }
  renderHeaderMeta(PROGRESS_STATE.me, { roleBadge: "roleBadge", mePill: "mePill", dashboardLink: "dashboardLink" });
  await loadAnalytics();
}

init().catch((error)=>{
  progressAlert("error", error.message || "Analytics yuklanmadi.");
});
