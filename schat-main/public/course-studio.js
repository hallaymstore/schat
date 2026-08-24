const {
  $, qs, apiFetch, getMe, initStoredTheme, applyTheme, renderHeaderMeta, logout,
  iconSpan, normalizeCourse, normalizeLesson, escapeHtml, shortText
} = window.CourseSuite;

const STUDIO_STATE = {
  me: null,
  course: null,
  lessons: [],
  activeLessonId: "",
  creatingLesson: false,
  videoUpload: null
};

function alertStudio(type, message){
  const box = $("pageAlert");
  box.className = "course-alert show " + (type === "error" ? "error" : "success");
  box.textContent = message;
}

function clearStudioAlert(){
  $("pageAlert").className = "course-alert";
  $("pageAlert").textContent = "";
}

function courseDefaults(){
  return {
    id: "",
    title: "",
    description: "",
    type: "free",
    price: 0,
    status: "draft",
    visibility: "public",
    joinMode: "open",
    allowComments: true,
    allowRatings: true,
    allowSequential: true,
    faculty: "",
    category: "",
    tags: [],
    studyDirections: [],
    groups: [],
    language: "uz",
    level: "beginner",
    youtubeUrl: "",
    coverUrl: "",
    requirements: "",
    outcomes: ""
  };
}

function lessonDefaults(order){
  return {
    id: "",
    order,
    title: "",
    type: "video",
    text: "",
    youtubeUrl: "",
    videoUrl: "",
    pdfUrl: "",
    durationMinutes: 0,
    isPreview: false,
    quizEnabled: false,
    quizTitle: "",
    quizPassPct: 60,
    quizQuestions: [],
    materials: []
  };
}

function readCourseForm(){
  return {
    title: $("courseTitle").value.trim(),
    description: $("courseDescription").value.trim(),
    type: $("courseType").value,
    price: Number($("coursePrice").value || 0),
    status: $("courseStatus").value,
    visibility: $("courseVisibility").value,
    joinMode: $("courseJoinMode").value,
    allowComments: $("courseAllowComments").checked,
    allowRatings: $("courseAllowRatings").checked,
    allowSequential: $("courseAllowSequential").checked,
    faculty: $("courseFaculty").value.trim(),
    category: $("courseCategory").value.trim(),
    tags: $("courseTags").value.split(",").map((item)=> item.trim()).filter(Boolean),
    studyDirections: $("courseDirections").value.split(",").map((item)=> item.trim()).filter(Boolean),
    groups: $("courseGroups").value.split(",").map((item)=> item.trim()).filter(Boolean),
    language: $("courseLanguage").value.trim(),
    level: $("courseLevel").value,
    youtubeUrl: $("courseYoutube").value.trim(),
    coverUrl: $("courseCover").value.trim(),
    requirements: $("courseRequirements").value.trim(),
    outcomes: $("courseOutcomes").value.trim()
  };
}

function fillCourseForm(course){
  $("courseTitle").value = course.title || "";
  $("courseDescription").value = course.description || "";
  $("courseType").value = course.type || "free";
  $("coursePrice").value = Number(course.price || 0);
  $("courseStatus").value = course.status || "draft";
  $("courseVisibility").value = course.visibility || "public";
  $("courseJoinMode").value = course.joinMode || "open";
  $("courseAllowComments").checked = course.allowComments !== false;
  $("courseAllowRatings").checked = course.allowRatings !== false;
  $("courseAllowSequential").checked = course.allowSequential !== false;
  $("courseFaculty").value = course.faculty || "";
  $("courseCategory").value = course.category || "";
  $("courseTags").value = (course.tags || []).join(", ");
  $("courseDirections").value = (course.studyDirections || []).join(", ");
  $("courseGroups").value = (course.groups || []).join(", ");
  $("courseLanguage").value = course.language || "uz";
  $("courseLevel").value = course.level || "beginner";
  $("courseYoutube").value = course.youtubeUrl || "";
  $("courseCover").value = course.coverUrl || "";
  $("courseRequirements").value = course.requirements || "";
  $("courseOutcomes").value = course.outcomes || "";
}

function renderStudioHeader(){
  const role = String(STUDIO_STATE.me.role || "teacher").toLowerCase();
  const isNew = !STUDIO_STATE.course.id;
  $("studioHero").innerHTML = `
    <section class="course-card">
      <div class="course-split">
        <div>
          <div class="course-eyebrow">${iconSpan("settings")}Teacher Course Studio</div>
          <h1 class="course-big-title" style="font-size:clamp(2rem, 1.3rem + 2vw, 3.8rem)">${escapeHtml(isNew ? "Yangi kurs yaratish" : STUDIO_STATE.course.title || "Kurs studio")}</h1>
          <p class="course-section-copy">Bu sahifada kurs sozlamalari, videodars bo'limlari, PDF upload, qo'shimcha materiallar va har mavzu uchun optional quiz boshqariladi.</p>
          <div class="course-inline-actions">
            ${STUDIO_STATE.course.id ? `<a class="course-link-button" href="/course.html?id=${encodeURIComponent(STUDIO_STATE.course.id)}">${iconSpan("eye")}Kursni ko'rish</a>` : ""}
            ${STUDIO_STATE.course.id ? `<a class="course-link-button" href="/course-progress.html?id=${encodeURIComponent(STUDIO_STATE.course.id)}">${iconSpan("chart")}Natijalar</a>` : ""}
            <button class="course-button primary" id="saveCourseBtnTop">${iconSpan("check")}Kursni saqlash</button>
          </div>
        </div>
        <div class="course-card tight">
          <div class="course-summary-grid">
            <div class="course-summary">
              <div class="course-muted">Status</div>
              <div class="course-summary-value" style="font-size:1rem">${escapeHtml(STUDIO_STATE.course.status || "draft")}</div>
            </div>
            <div class="course-summary">
              <div class="course-muted">Join mode</div>
              <div class="course-summary-value" style="font-size:1rem">${escapeHtml(STUDIO_STATE.course.joinMode === "approval" ? "Approval" : "Open")}</div>
            </div>
            <div class="course-summary">
              <div class="course-muted">Mavzular</div>
              <div class="course-summary-value">${STUDIO_STATE.lessons.length}</div>
            </div>
          </div>
          <div class="course-muted" style="margin-top:14px">${role === "admin" ? "Admin sifatida har qanday kursni ko'rib chiqishingiz mumkin." : "Teacher sifatida o'zingizga tegishli kurslar boshqariladi."}</div>
        </div>
      </div>
    </section>
  `;
  $("saveCourseBtnTop").addEventListener("click", saveCourse);
}

function renderLessonList(){
  const activeId = String(STUDIO_STATE.activeLessonId || "");
  $("lessonList").innerHTML = STUDIO_STATE.course.id ? (STUDIO_STATE.lessons.length ? STUDIO_STATE.lessons.map((lesson, index)=> `
    <article class="course-row-card compact ${String(lesson.id) === activeId ? "active" : ""}" data-lesson="${escapeHtml(lesson.id)}">
      <div class="course-row-main">
        <div class="course-chip-row">
          <span class="course-tag">${index + 1}-mavzu</span>
          <span class="course-tag">${escapeHtml(String(lesson.type || "").toUpperCase())}</span>
          ${lesson.quizEnabled ? `<span class="course-tag accent">Quiz</span>` : ""}
        </div>
        <h3 class="course-row-title" style="margin-top:10px">${escapeHtml(lesson.title || "Nomsiz mavzu")}</h3>
        <div class="course-row-copy">${escapeHtml(shortText(lesson.text || "Video, PDF yoki matn.", 90))}</div>
      </div>
    </article>
  `).join("") : `<div class="course-empty">Mavzular hali qo'shilmagan.</div>`) : `<div class="course-empty">Avval kursni saqlang, keyin mavzular qo'shiladi.</div>`;

  $("lessonList").querySelectorAll("[data-lesson]").forEach((item)=>{
    item.addEventListener("click", ()=>{
      STUDIO_STATE.creatingLesson = false;
      STUDIO_STATE.activeLessonId = item.dataset.lesson || "";
      fillLessonForm(STUDIO_STATE.lessons.find((lesson)=> String(lesson.id) === String(STUDIO_STATE.activeLessonId)));
      renderLessonList();
    });
  });
}

function currentLesson(){
  return STUDIO_STATE.lessons.find((lesson)=> String(lesson.id) === String(STUDIO_STATE.activeLessonId)) || null;
}

function renderQuizQuestions(questions){
  $("quizQuestions").innerHTML = questions.length ? questions.map((question, index)=> `
    <article class="course-quiz-question" data-question-index="${index}">
      <div class="course-inline-actions" style="justify-content:space-between">
        <strong>${index + 1}-savol</strong>
        <button class="course-button danger" type="button" data-remove-question="${index}">${iconSpan("trash")}O'chirish</button>
      </div>
      <div class="course-form-group" style="margin-top:12px">
        <label>Savol matni</label>
        <textarea class="course-textarea" data-field="question-text">${escapeHtml(question.text || "")}</textarea>
      </div>
      <div class="course-option-grid" style="margin-top:12px">
        ${(question.options || []).map((option, optionIndex)=> `
          <div class="course-form-group">
            <label>Variant ${option.key || String.fromCharCode(65 + optionIndex)}</label>
            <input class="course-input" data-field="option-text" data-option-index="${optionIndex}" value="${escapeHtml(option.text || "")}">
          </div>
        `).join("")}
      </div>
      <div class="course-form-row" style="margin-top:12px">
        <div class="course-form-group" style="flex:1">
          <label>To'g'ri javob</label>
          <select class="course-select" data-field="answer-key">
            ${(question.options || []).map((option)=> `<option value="${escapeHtml(option.key || "")}" ${String(option.key) === String(question.answerKey || "") ? "selected" : ""}>${escapeHtml(option.key || "")}</option>`).join("")}
          </select>
        </div>
        <div class="course-form-group" style="flex:2">
          <label>Izoh</label>
          <input class="course-input" data-field="explanation" value="${escapeHtml(question.explanation || "")}">
        </div>
      </div>
    </article>
  `).join("") : `<div class="course-empty">Quiz savollari hali qo'shilmagan.</div>`;

  $("quizQuestions").querySelectorAll("[data-remove-question]").forEach((button)=>{
    button.addEventListener("click", ()=>{
      const lesson = readLessonForm();
      lesson.quizQuestions.splice(Number(button.dataset.removeQuestion || 0), 1);
      fillLessonForm(lesson);
    });
  });
}

function fillLessonForm(lesson){
  const current = lesson || lessonDefaults(STUDIO_STATE.lessons.length + 1);
  $("lessonTitle").value = current.title || "";
  $("lessonType").value = current.type || "video";
  $("lessonOrder").value = Number(current.order || STUDIO_STATE.lessons.length + 1);
  $("lessonDuration").value = Number(current.durationMinutes || 0);
  $("lessonText").value = current.text || "";
  $("lessonYoutube").value = current.youtubeUrl || "";
  $("lessonVideo").value = current.videoUrl || "";
  $("lessonPdf").value = current.pdfUrl || "";
  syncLessonSourceFields();
  $("lessonPreview").checked = !!current.isPreview;
  $("lessonQuizEnabled").checked = !!current.quizEnabled;
  $("lessonQuizTitle").value = current.quizTitle || "";
  $("lessonQuizPass").value = Number(current.quizPassPct || 60);
  renderQuizQuestions(current.quizQuestions || []);
  renderLessonMaterials(current.materials || []);
  $("lessonDeleteBtn").style.display = current.id ? "inline-flex" : "none";
  $("lessonAssetUploadBtn").disabled = !current.id;
  $("lessonMaterialsUploadBtn").disabled = !current.id;
}

function syncLessonSourceFields(){
  const type = String($("lessonType")?.value || "video");
  const visibility = {
    lessonYoutubeField: type === "youtube",
    lessonVideoField: type === "video",
    lessonPdfField: type === "pdf"
  };
  Object.entries(visibility).forEach(([id, visible])=>{
    const element = $(id);
    if(element) element.style.display = visible ? "" : "none";
  });
}

function renderLessonMaterials(materials){
  $("lessonMaterialsList").innerHTML = materials.length ? materials.map((material)=> `
    <article class="course-row-card compact">
      <div class="course-row-main">
        <h3 class="course-row-title">${escapeHtml(material.name || "material")}</h3>
        <div class="course-row-copy">${escapeHtml(material.mimeType || "Fayl")}</div>
      </div>
      <div class="course-inline-actions">
        <a class="course-link-button" target="_blank" rel="noopener" href="${escapeHtml(material.url || "#")}">${iconSpan("eye")}Ochish</a>
        ${material._id || material.id ? `<button class="course-button danger" type="button" data-delete-material="${escapeHtml(material._id || material.id)}">${iconSpan("trash")}O'chirish</button>` : ""}
      </div>
    </article>
  `).join("") : `<div class="course-empty">Material qo'shilmagan.</div>`;

  $("lessonMaterialsList").querySelectorAll("[data-delete-material]").forEach((button)=>{
    button.addEventListener("click", ()=> deleteMaterial(button.dataset.deleteMaterial));
  });
}

function readQuizQuestionsFromDom(){
  return Array.from($("quizQuestions").querySelectorAll("[data-question-index]")).map((block, index)=>{
    const options = Array.from(block.querySelectorAll("[data-field='option-text']")).map((input, optionIndex)=> ({
      key: String.fromCharCode(65 + optionIndex),
      text: input.value.trim()
    })).filter((option)=> option.text);
    return {
      id: "q" + (index + 1),
      text: block.querySelector("[data-field='question-text']").value.trim(),
      options,
      answerKey: block.querySelector("[data-field='answer-key']").value,
      explanation: block.querySelector("[data-field='explanation']").value.trim()
    };
  }).filter((question)=> question.text && question.options.length >= 2);
}

function readLessonForm(){
  return {
    id: currentLesson()?.id || "",
    title: $("lessonTitle").value.trim(),
    type: $("lessonType").value,
    order: Number($("lessonOrder").value || STUDIO_STATE.lessons.length + 1),
    durationMinutes: Number($("lessonDuration").value || 0),
    text: $("lessonText").value.trim(),
    youtubeUrl: $("lessonYoutube").value.trim(),
    videoUrl: $("lessonVideo").value.trim(),
    pdfUrl: $("lessonPdf").value.trim(),
    isPreview: $("lessonPreview").checked,
    quizEnabled: $("lessonQuizEnabled").checked,
    quizTitle: $("lessonQuizTitle").value.trim(),
    quizPassPct: Number($("lessonQuizPass").value || 60),
    quizQuestions: readQuizQuestionsFromDom(),
    materials: currentLesson()?.materials || []
  };
}

async function saveCourse(){
  try{
    clearStudioAlert();
    const payload = readCourseForm();
    if(!payload.title){
      alertStudio("error", "Kurs nomi majburiy.");
      return;
    }
    const method = STUDIO_STATE.course.id ? "PUT" : "POST";
    const url = STUDIO_STATE.course.id ? `/api/courses/${encodeURIComponent(STUDIO_STATE.course.id)}` : "/api/courses";
    const data = await apiFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    STUDIO_STATE.course = normalizeCourse(data?.course || data);
    fillCourseForm(STUDIO_STATE.course);
    renderStudioHeader();
    renderLessonList();
    if(!qs("id")){
      window.history.replaceState({}, "", "/course-studio.html?id=" + encodeURIComponent(STUDIO_STATE.course.id));
    }
    alertStudio("success", "Kurs saqlandi.");
  }catch(error){
    alertStudio("error", error.message || "Kurs saqlanmadi.");
  }
}

async function loadLessons(){
  if(!STUDIO_STATE.course.id){
    STUDIO_STATE.lessons = [];
    renderLessonList();
    fillLessonForm(null);
    return;
  }
  const data = await apiFetch(`/api/courses/${encodeURIComponent(STUDIO_STATE.course.id)}/content`);
  STUDIO_STATE.lessons = (Array.isArray(data?.items) ? data.items : []).map(normalizeLesson);
  const preferred = STUDIO_STATE.lessons.find((lesson)=> String(lesson.id) === String(STUDIO_STATE.activeLessonId)) || STUDIO_STATE.lessons[0] || null;
  STUDIO_STATE.activeLessonId = preferred?.id || "";
  renderLessonList();
  fillLessonForm(preferred);
}

async function loadCourse(){
  const courseId = qs("id");
  if(!courseId){
    STUDIO_STATE.course = courseDefaults();
    fillCourseForm(STUDIO_STATE.course);
    renderStudioHeader();
    renderLessonList();
    fillLessonForm(null);
    return;
  }
  const data = await apiFetch(`/api/courses/${encodeURIComponent(courseId)}`);
  STUDIO_STATE.course = normalizeCourse(data?.course || data);
  fillCourseForm(STUDIO_STATE.course);
  renderStudioHeader();
  await loadLessons();
}

async function saveLesson(){
  try{
    clearStudioAlert();
    if(!STUDIO_STATE.course.id){
      alertStudio("error", "Avval kursni saqlang.");
      return;
    }
    const payload = readLessonForm();
    if(!payload.title){
      alertStudio("error", "Mavzu sarlavhasi majburiy.");
      return;
    }
    const isEdit = !!payload.id;
    const url = isEdit
      ? `/api/courses/${encodeURIComponent(STUDIO_STATE.course.id)}/content/${encodeURIComponent(payload.id)}`
      : `/api/courses/${encodeURIComponent(STUDIO_STATE.course.id)}/content`;
    const data = await apiFetch(url, {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    STUDIO_STATE.activeLessonId = String(data?.item?._id || data?.item?.id || payload.id || "");
    await loadLessons();
    alertStudio("success", "Mavzu saqlandi.");
  }catch(error){
    alertStudio("error", error.message || "Mavzu saqlanmadi.");
  }
}

async function deleteLesson(){
  const lesson = currentLesson();
  if(!lesson || !lesson.id) return;
  if(!window.confirm(`"${lesson.title}" mavzusini o'chirasizmi?`)) return;
  try{
    await apiFetch(`/api/courses/${encodeURIComponent(STUDIO_STATE.course.id)}/content/${encodeURIComponent(lesson.id)}`, {
      method: "DELETE"
    });
    STUDIO_STATE.activeLessonId = "";
    await loadLessons();
    alertStudio("success", "Mavzu o'chirildi.");
  }catch(error){
    alertStudio("error", error.message || "Mavzu o'chirilmadi.");
  }
}

async function deleteMaterial(materialId){
  const lesson = currentLesson();
  if(!lesson || !lesson.id) return;
  try{
    await apiFetch(`/api/courses/${encodeURIComponent(STUDIO_STATE.course.id)}/content/${encodeURIComponent(lesson.id)}/materials/${encodeURIComponent(materialId)}`, {
      method: "DELETE"
    });
    await loadLessons();
    alertStudio("success", "Material o'chirildi.");
  }catch(error){
    alertStudio("error", error.message || "Material o'chirilmadi.");
  }
}

function videoUploadStorageKey(file, lesson){
  return [
    "hallaym:course-video:v1",
    STUDIO_STATE.course?.id || "",
    lesson?.id || "",
    file?.name || "",
    Number(file?.size || 0),
    Number(file?.lastModified || 0)
  ].join(":");
}

function formatUploadBytes(value){
  const bytes = Math.max(0, Number(value || 0));
  if(bytes >= 1024 ** 3) return (bytes / (1024 ** 3)).toFixed(2) + " GB";
  if(bytes >= 1024 ** 2) return (bytes / (1024 ** 2)).toFixed(1) + " MB";
  return Math.round(bytes / 1024) + " KB";
}

function showLargeVideoProgress(file, percent, status){
  const wrap = $("largeVideoUpload");
  wrap.hidden = false;
  $("largeVideoUploadName").textContent = file?.name || "Video yuklanmoqda";
  $("largeVideoUploadPercent").textContent = Math.max(0, Math.min(100, Math.round(percent || 0))) + "%";
  $("largeVideoUploadBar").value = Math.max(0, Math.min(100, Number(percent || 0)));
  $("largeVideoUploadStatus").textContent = status || "Yuklanmoqda…";
}

async function waitForVideoUploadResume(state){
  while(state.paused && !state.cancelled && !state.failed){
    await new Promise((resolve)=> window.setTimeout(resolve, 220));
  }
}

async function uploadLargeLessonVideo(file, lesson){
  const base = `/api/courses/${encodeURIComponent(STUDIO_STATE.course.id)}/content/${encodeURIComponent(lesson.id)}/video-upload`;
  const storageKey = videoUploadStorageKey(file, lesson);
  const state = {
    file,
    lesson,
    base,
    storageKey,
    paused: false,
    cancelled: false,
    failed: false,
    controllers: new Set(),
    session: null
  };
  STUDIO_STATE.videoUpload = state;
  $("largeVideoPauseBtn").textContent = "Pauza";
  showLargeVideoProgress(file, 0, `${formatUploadBytes(file.size)} video uchun davom ettiriladigan yuklash tayyorlanmoqda…`);

  let saved = null;
  try{ saved = JSON.parse(localStorage.getItem(storageKey) || "null"); }catch(_){ saved = null; }
  if(saved?.token){
    try{
      const status = await apiFetch(base + "/status", { headers: { "X-Upload-Token": saved.token } });
      state.session = { ...saved, ...status, token: saved.token };
    }catch(_){
      localStorage.removeItem(storageKey);
    }
  }

  if(!state.session){
    const started = await apiFetch(base + "/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "video/mp4",
        lastModified: file.lastModified || 0
      })
    });
    state.session = started;
    localStorage.setItem(storageKey, JSON.stringify({
      token: started.token,
      partSize: started.partSize,
      partCount: started.partCount,
      fileName: file.name,
      fileSize: file.size,
      lastModified: file.lastModified || 0
    }));
  }

  const session = state.session;
  const partSize = Number(session.partSize || (8 * 1024 * 1024));
  const partCount = Number(session.partCount || Math.ceil(file.size / partSize));
  const uploaded = new Set((session.uploadedParts || []).map((part)=> Number(part.partNumber || 0)).filter(Boolean));
  const missing = [];
  for(let partNumber = 1; partNumber <= partCount; partNumber += 1){
    if(!uploaded.has(partNumber)) missing.push(partNumber);
  }

  const uploadedBytes = ()=>{
    let total = 0;
    uploaded.forEach((partNumber)=>{
      const start = (partNumber - 1) * partSize;
      total += Math.max(0, Math.min(partSize, file.size - start));
    });
    return total;
  };
  const update = ()=>{
    const doneBytes = uploadedBytes();
    const percent = file.size ? (doneBytes / file.size) * 100 : 0;
    showLargeVideoProgress(
      file,
      percent,
      state.paused
        ? `Pauza: ${formatUploadBytes(doneBytes)} / ${formatUploadBytes(file.size)}`
        : `${formatUploadBytes(doneBytes)} / ${formatUploadBytes(file.size)} • ${uploaded.size}/${partCount} bo‘lak`
    );
  };
  update();

  let cursor = 0;
  const worker = async ()=>{
    while(cursor < missing.length && !state.cancelled && !state.failed){
      await waitForVideoUploadResume(state);
      if(state.cancelled || state.failed) return;
      const partNumber = missing[cursor++];
      const start = (partNumber - 1) * partSize;
      const end = Math.min(file.size, start + partSize);
      const controller = new AbortController();
      state.controllers.add(controller);
      try{
        await apiFetch(`${base}/part/${partNumber}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Upload-Token": session.token
          },
          body: file.slice(start, end),
          signal: controller.signal
        });
        uploaded.add(partNumber);
        update();
      }catch(error){
        if(!state.cancelled){
          state.failed = true;
          throw error;
        }
      }finally{
        state.controllers.delete(controller);
      }
    }
  };

  try{
    await Promise.all([worker(), worker()]);
    if(state.cancelled) return false;
    if(state.failed) throw new Error("Video bo‘lagini yuklash to‘xtadi. Qayta bosilsa davom etadi.");
    showLargeVideoProgress(file, 100, "Video tekshirilmoqda va kursga biriktirilmoqda…");
    await apiFetch(base + "/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: session.token })
    });
    localStorage.removeItem(storageKey);
    showLargeVideoProgress(file, 100, "Video muvaffaqiyatli yuklandi.");
    return true;
  }catch(error){
    if(!state.cancelled){
      showLargeVideoProgress(file, (uploadedBytes() / file.size) * 100, "Ulanish uzildi. Shu faylni qayta tanlab bosilsa davom etadi.");
    }
    throw error;
  }finally{
    if(STUDIO_STATE.videoUpload === state && (state.cancelled || !state.failed)) STUDIO_STATE.videoUpload = null;
  }
}

async function cancelLargeVideoUpload(){
  const state = STUDIO_STATE.videoUpload;
  if(!state) return;
  state.cancelled = true;
  state.controllers.forEach((controller)=> controller.abort());
  try{
    if(state.session?.token){
      await apiFetch(state.base, {
        method: "DELETE",
        headers: { "X-Upload-Token": state.session.token }
      });
    }
  }catch(_){}
  localStorage.removeItem(state.storageKey);
  STUDIO_STATE.videoUpload = null;
  showLargeVideoProgress(state.file, 0, "Yuklash bekor qilindi.");
}

async function uploadLessonAsset(target){
  const lesson = currentLesson();
  if(!lesson || !lesson.id){
    alertStudio("error", "Avval mavzuni saqlang.");
    return;
  }
  const input = $("lessonAssetInput");
  const file = input.files?.[0];
  if(!file){
    alertStudio("error", "Avval fayl tanlang.");
    return;
  }
  try{
    if(target === "video" && Number(file.size || 0) >= (32 * 1024 * 1024)){
      const completed = await uploadLargeLessonVideo(file, lesson);
      if(!completed) return;
      input.value = "";
      await loadLessons();
      alertStudio("success", "Katta video yuklandi va barcha talabalar uchun tayyor.");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    formData.append("target", target);
    await apiFetch(`/api/courses/${encodeURIComponent(STUDIO_STATE.course.id)}/content/${encodeURIComponent(lesson.id)}/asset`, {
      method: "POST",
      body: formData
    });
    input.value = "";
    await loadLessons();
    alertStudio("success", target === "pdf" ? "PDF yuklandi." : "Video yuklandi.");
  }catch(error){
    alertStudio("error", error.message || "Fayl yuklanmadi.");
  }
}

async function uploadLessonMaterials(){
  const lesson = currentLesson();
  if(!lesson || !lesson.id){
    alertStudio("error", "Avval mavzuni saqlang.");
    return;
  }
  const input = $("lessonMaterialsInput");
  const files = Array.from(input.files || []);
  if(!files.length){
    alertStudio("error", "Material fayllarni tanlang.");
    return;
  }
  try{
    const formData = new FormData();
    files.forEach((file)=> formData.append("materials", file));
    await apiFetch(`/api/courses/${encodeURIComponent(STUDIO_STATE.course.id)}/content/${encodeURIComponent(lesson.id)}/materials`, {
      method: "POST",
      body: formData
    });
    input.value = "";
    await loadLessons();
    alertStudio("success", "Materiallar yuklandi.");
  }catch(error){
    alertStudio("error", error.message || "Materiallar yuklanmadi.");
  }
}

function createNewLesson(){
  if(!STUDIO_STATE.course.id){
    alertStudio("error", "Avval kursni saqlang.");
    return;
  }
  STUDIO_STATE.activeLessonId = "";
  STUDIO_STATE.creatingLesson = true;
  fillLessonForm(lessonDefaults(STUDIO_STATE.lessons.length + 1));
  renderLessonList();
}

function addQuestion(){
  const lesson = readLessonForm();
  const questions = lesson.quizQuestions || [];
  questions.push({
    id: "q" + (questions.length + 1),
    text: "",
    options: [
      { key: "A", text: "" },
      { key: "B", text: "" },
      { key: "C", text: "" },
      { key: "D", text: "" }
    ],
    answerKey: "A",
    explanation: ""
  });
  fillLessonForm({ ...lesson, quizQuestions: questions });
}

async function init(){
  initStoredTheme();
  applyTheme($("themeBtn"));
  $("logoutBtn").addEventListener("click", logout);
  $("lessonType").addEventListener("change", syncLessonSourceFields);
  STUDIO_STATE.me = await getMe();
  if(!STUDIO_STATE.me) return;
  if(!["teacher", "admin"].includes(String(STUDIO_STATE.me.role || "").toLowerCase())){
    alertStudio("error", "Bu sahifa teacher yoki admin uchun.");
    return;
  }
  renderHeaderMeta(STUDIO_STATE.me, { roleBadge: "roleBadge", mePill: "mePill", dashboardLink: "dashboardLink" });
  await loadCourse();

  $("saveCourseBtn").addEventListener("click", saveCourse);
  $("saveLessonBtn").addEventListener("click", saveLesson);
  $("lessonDeleteBtn").addEventListener("click", deleteLesson);
  $("addLessonBtn").addEventListener("click", createNewLesson);
  $("addQuestionBtn").addEventListener("click", addQuestion);
  $("lessonAssetUploadBtn").addEventListener("click", ()=>{
    const file = $("lessonAssetInput").files?.[0];
    const lowerName = String(file?.name || "").toLowerCase();
    const target = (file?.type || "").includes("pdf") || lowerName.endsWith(".pdf") || $("lessonType").value === "pdf"
      ? "pdf"
      : "video";
    uploadLessonAsset(target);
  });
  $("lessonMaterialsUploadBtn").addEventListener("click", uploadLessonMaterials);
  $("largeVideoPauseBtn").addEventListener("click", ()=>{
    const state = STUDIO_STATE.videoUpload;
    if(!state) return;
    state.paused = !state.paused;
    $("largeVideoPauseBtn").textContent = state.paused ? "Davom ettirish" : "Pauza";
    showLargeVideoProgress(state.file, Number($("largeVideoUploadBar").value || 0), state.paused ? "Yuklash pauzada." : "Yuklash davom etmoqda…");
  });
  $("largeVideoCancelBtn").addEventListener("click", cancelLargeVideoUpload);
}

init().catch((error)=>{
  alertStudio("error", error.message || "Studio sahifasi yuklanmadi.");
});
