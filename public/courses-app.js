const {
  $, apiFetch, getMe, initStoredTheme, applyTheme, renderHeaderMeta, logout,
  iconSpan, normalizeCourse, escapeHtml, shortText, money, formatDate
} = window.CourseSuite;

const COURSES_STATE = {
  me: null,
  courses: [],
  filtered: []
};

function setAlert(type, message){
  const box = $("pageAlert");
  if(!box) return;
  box.className = "course-alert show " + (type === "error" ? "error" : "success");
  box.textContent = message;
}

function clearAlert(){
  const box = $("pageAlert");
  if(!box) return;
  box.className = "course-alert";
  box.textContent = "";
}

function buildCardMeta(course){
  const tags = [];
  tags.push(course.type === "paid"
    ? `<span class="course-tag warn">${escapeHtml(money(course.price))}</span>`
    : `<span class="course-tag success">Bepul</span>`);
  tags.push(`<span class="course-tag ${course.status === "published" ? "accent" : "danger"}">${course.status === "published" ? "Published" : "Draft"}</span>`);
  tags.push(`<span class="course-tag">${course.joinMode === "approval" ? "So'rov bilan" : "Darhol kirish"}</span>`);
  tags.push(`<span class="course-tag">${course.lessonCount || 0} mavzu</span>`);
  tags.push(`<span class="course-tag">${course.ratingAverage ? course.ratingAverage.toFixed(1) : "0.0"} / 5</span>`);
  return tags.join("");
}

function matchCourse(course){
  const q = String($("searchInput").value || "").trim().toLowerCase();
  const faculty = $("facultyFilter").value || "";
  const price = $("priceFilter").value || "";
  const joinMode = $("joinModeFilter").value || "";

  if(faculty && course.faculty !== faculty) return false;
  if(price && course.type !== price) return false;
  if(joinMode && course.joinMode !== joinMode) return false;
  if(!q) return true;

  const hay = [
    course.title,
    course.description,
    course.teacherName,
    course.faculty,
    (course.groups || []).join(" ")
  ].join(" ").toLowerCase();
  return hay.includes(q);
}

function sortCourses(list){
  const mode = $("sortFilter").value || "new";
  return [...list].sort((a, b)=>{
    if(mode === "title") return String(a.title || "").localeCompare(String(b.title || ""), "uz");
    if(mode === "rating") return Number(b.ratingAverage || 0) - Number(a.ratingAverage || 0);
    if(mode === "lessons") return Number(b.lessonCount || 0) - Number(a.lessonCount || 0);
    if(mode === "price") return Number(a.price || 0) - Number(b.price || 0);
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });
}

function renderSummary(){
  $("catalogCount").textContent = String(COURSES_STATE.filtered.length);
  $("teacherCount").textContent = String(new Set(COURSES_STATE.courses.map((course)=> String(course.teacherId || "")).filter(Boolean)).size);
  $("lessonCount").textContent = String(COURSES_STATE.courses.reduce((sum, course)=> sum + Number(course.lessonCount || 0), 0));
}

function renderCourses(){
  const list = $("courseList");
  COURSES_STATE.filtered = sortCourses(COURSES_STATE.courses.filter(matchCourse));
  renderSummary();
  if(!COURSES_STATE.filtered.length){
    list.innerHTML = `<div class="course-empty">Mos kurs topilmadi. Filterlarni tozalab yana tekshirib ko'ring.</div>`;
    return;
  }

  const meId = String(COURSES_STATE.me?._id || "");
  const role = String(COURSES_STATE.me?.role || "student").toLowerCase();

  list.innerHTML = COURSES_STATE.filtered.map((course)=>{
    const isOwner = meId && String(course.teacherId || "") === meId;
    const canManage = role === "admin" || isOwner;
    const cover = String(course.coverUrl || "").trim();
    const groupsText = course.groups && course.groups.length ? course.groups.join(", ") : "Guruh cheklovi yo'q";
    return `
      <article class="course-row-card">
        <div class="course-thumb">${cover ? `<img src="${escapeHtml(cover)}" alt="${escapeHtml(course.title)}">` : ""}</div>
        <div class="course-row-main">
          <div class="course-chip-row">${buildCardMeta(course)}</div>
          <h3 class="course-row-title" style="margin-top:12px">${escapeHtml(course.title)}</h3>
          <p class="course-row-copy">${escapeHtml(shortText(course.description || "Kurs tavsifi hozircha kiritilmagan.", 220))}</p>
          <div class="course-meta-row" style="margin-top:10px">
            <span class="course-inline-code">${escapeHtml(course.teacherName || "O'qituvchi")}</span>
            <span class="course-inline-code">${escapeHtml(course.faculty || "Fakultet belgilanmagan")}</span>
            <span class="course-inline-code">${escapeHtml(groupsText)}</span>
          </div>
          <div class="course-inline-actions" style="margin-top:16px">
            <a class="course-link-button primary" href="/course.html?id=${encodeURIComponent(course.id)}">${iconSpan("eye")}Ko'rish</a>
            ${canManage ? `<a class="course-link-button" href="/course-studio.html?id=${encodeURIComponent(course.id)}">${iconSpan("settings")}Studio</a>` : ""}
            ${canManage ? `<a class="course-link-button" href="/course-progress.html?id=${encodeURIComponent(course.id)}">${iconSpan("chart")}Natijalar</a>` : ""}
            ${canManage ? `<button class="course-button ghost" data-action="duplicate" data-id="${escapeHtml(course.id)}">${iconSpan("copy")}Nusxa</button>` : ""}
            ${canManage ? `<button class="course-button danger" data-action="delete" data-id="${escapeHtml(course.id)}">${iconSpan("trash")}O'chirish</button>` : ""}
          </div>
          <div class="course-muted" style="margin-top:10px">Yaratilgan: ${escapeHtml(formatDate(course.createdAt) || "noma'lum")}</div>
        </div>
      </article>
    `;
  }).join("");

  list.querySelectorAll("[data-action='duplicate']").forEach((button)=>{
    button.addEventListener("click", async ()=>{
      await duplicateCourse(button.dataset.id);
    });
  });
  list.querySelectorAll("[data-action='delete']").forEach((button)=>{
    button.addEventListener("click", async ()=>{
      await deleteCourse(button.dataset.id);
    });
  });
}

async function loadCourses(){
  const data = await apiFetch("/api/courses");
  const list = Array.isArray(data?.courses) ? data.courses : [];
  COURSES_STATE.courses = list.map(normalizeCourse);
  const faculties = Array.from(new Set(COURSES_STATE.courses.map((course)=> course.faculty).filter(Boolean)));
  $("facultyFilter").innerHTML = '<option value="">Fakultet: barchasi</option>' + faculties.map((faculty)=> `<option value="${escapeHtml(faculty)}">${escapeHtml(faculty)}</option>`).join("");
  renderCourses();
}

async function duplicateCourse(courseId){
  try{
    clearAlert();
    const detail = await apiFetch("/api/courses/" + encodeURIComponent(courseId));
    let lessons = [];
    try{
      const content = await apiFetch(`/api/courses/${encodeURIComponent(courseId)}/content`);
      lessons = Array.isArray(content?.items) ? content.items : [];
    }catch(_){
      lessons = [];
    }
    const course = normalizeCourse(detail?.course || detail);
    await apiFetch("/api/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: course.title + " (nusxa)",
        description: course.description,
        type: course.type,
        price: course.price,
        status: "draft",
        joinMode: course.joinMode,
        allowComments: course.allowComments,
        allowRatings: course.allowRatings,
        allowSequential: course.allowSequential,
        faculty: course.faculty,
        groups: course.groups,
        youtubeUrl: course.youtubeUrl,
        coverUrl: course.coverUrl,
        language: course.language,
        level: course.level,
        requirements: course.requirements,
        outcomes: course.outcomes,
        lessons
      })
    });
    await loadCourses();
    setAlert("success", "Kurs nusxasi draft holatda yaratildi.");
  }catch(error){
    setAlert("error", error.message || "Kurs nusxalanmadi.");
  }
}

async function deleteCourse(courseId){
  const course = COURSES_STATE.courses.find((item)=> String(item.id) === String(courseId));
  if(!course) return;
  const approved = window.confirm(`"${course.title}" kursini o'chirasizmi?`);
  if(!approved) return;
  try{
    clearAlert();
    await apiFetch("/api/courses/" + encodeURIComponent(courseId), { method: "DELETE" });
    await loadCourses();
    setAlert("success", "Kurs o'chirildi.");
  }catch(error){
    setAlert("error", error.message || "Kurs o'chirilmadi.");
  }
}

async function init(){
  initStoredTheme();
  applyTheme($("themeBtn"));
  $("logoutBtn").addEventListener("click", logout);
  COURSES_STATE.me = await getMe();
  if(!COURSES_STATE.me) return;
  renderHeaderMeta(COURSES_STATE.me, { roleBadge: "roleBadge", mePill: "mePill", dashboardLink: "dashboardLink" });

  $("createCourseBtn").style.display = ["teacher", "admin"].includes(String(COURSES_STATE.me.role || "").toLowerCase()) ? "inline-flex" : "none";
  $("createCourseBtn").addEventListener("click", ()=>{
    window.location.href = "/course-studio.html";
  });
  ["searchInput", "facultyFilter", "priceFilter", "joinModeFilter", "sortFilter"].forEach((id)=>{
    $(id).addEventListener("input", renderCourses);
    $(id).addEventListener("change", renderCourses);
  });
  $("refreshBtn").addEventListener("click", async ()=>{
    clearAlert();
    await loadCourses();
    setAlert("success", "Kurslar yangilandi.");
  });

  await loadCourses();
}

init();
