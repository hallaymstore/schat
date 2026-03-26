const {
  $, qs, apiFetch, getMe, initStoredTheme, applyTheme, renderHeaderMeta, logout,
  iconSpan, normalizeCourse, normalizeLesson, escapeHtml, shortText,
  formatDate, mediaForLesson, money
} = window.CourseSuite;

const JOINED_STATE = {
  me: null,
  course: null,
  lessons: [],
  tests: [],
  progress: { doneLessonIds: [], testPassed: false, lessonQuizResults: {}, lastLessonId: "" },
  activeLessonId: "",
  selectedMaterialUrl: ""
};

function setAlert(type, message){
  const box = $("pageAlert");
  box.className = "course-alert show " + (type === "error" ? "error" : "success");
  box.textContent = message;
}

function clearAlert(){
  $("pageAlert").className = "course-alert";
  $("pageAlert").textContent = "";
}

function isStudent(){
  return String(JOINED_STATE.me?.role || "").toLowerCase() === "student";
}

function lessonDone(id){
  return JOINED_STATE.progress.doneLessonIds.includes(String(id));
}

function lessonQuizResult(id){
  return JOINED_STATE.progress.lessonQuizResults?.[String(id)] || null;
}

function lessonLocked(index){
  if(!JOINED_STATE.course?.allowSequential) return false;
  if(index <= 0) return false;
  const prev = JOINED_STATE.lessons[index - 1];
  return prev ? !lessonDone(prev.id) : false;
}

function renderHeader(){
  const role = String(JOINED_STATE.me.role || "student").toLowerCase();
  const meCanTrack = role === "admin" || JOINED_STATE.course.isOwner;
  $("heroArea").innerHTML = `
    <section class="course-card">
      <div class="course-split">
        <div>
          <div class="course-eyebrow">${iconSpan("play")}Kurs ichida ishlash</div>
          <h1 class="course-big-title" style="font-size:clamp(1.9rem, 1.2rem + 2vw, 3.8rem)">${escapeHtml(JOINED_STATE.course.title)}</h1>
          <p class="course-section-copy">${escapeHtml(JOINED_STATE.course.description || "Bu sahifada videodars, PDF materiallar va qisqa testlar ketma-ket ochiladi.")}</p>
          <div class="course-chip-row">
            <span class="course-tag">${JOINED_STATE.lessons.length} mavzu</span>
            <span class="course-tag">${JOINED_STATE.course.allowSequential ? "Ketma-ket" : "Erkin o'tish"}</span>
            <span class="course-tag">${JOINED_STATE.tests.length} umumiy test</span>
            <span class="course-tag">${JOINED_STATE.course.type === "paid" ? escapeHtml(money(JOINED_STATE.course.price)) : "Bepul"}</span>
          </div>
          <div class="course-inline-actions" style="margin-top:18px">
            <a class="course-link-button" href="/course.html?id=${encodeURIComponent(JOINED_STATE.course.id)}">${iconSpan("eye")}Kurs info</a>
            ${meCanTrack ? `<a class="course-link-button" href="/course-progress.html?id=${encodeURIComponent(JOINED_STATE.course.id)}">${iconSpan("chart")}Natijalar</a>` : ""}
            ${meCanTrack ? `<a class="course-link-button" href="/course-studio.html?id=${encodeURIComponent(JOINED_STATE.course.id)}">${iconSpan("settings")}Studio</a>` : ""}
          </div>
        </div>
        <div class="course-card tight">
          <div class="course-section-title">Progress</div>
          <div class="course-progress-bar" style="margin-top:14px"><span style="width:${calcProgress().pct}%"></span></div>
          <div class="course-summary-grid" style="margin-top:16px">
            <div class="course-summary">
              <div class="course-muted">Foiz</div>
              <div class="course-summary-value">${calcProgress().pct}%</div>
            </div>
            <div class="course-summary">
              <div class="course-muted">Tugagan</div>
              <div class="course-summary-value">${calcProgress().doneCount}/${calcProgress().total}</div>
            </div>
            <div class="course-summary">
              <div class="course-muted">Quizlar</div>
              <div class="course-summary-value">${Object.values(JOINED_STATE.progress.lessonQuizResults || {}).filter((item)=> item?.passed).length}</div>
            </div>
          </div>
          <div class="course-muted" style="margin-top:14px">
            ${isStudent() ? "Har mavzuni tugatgach 'Tugatdim' bosiladi. Quiz bo'lsa, avval undan o'tish kerak." : "Teacher/Admin preview rejimi. Sahifa real dars oqimini tekshirish uchun ochilgan."}
          </div>
        </div>
      </div>
    </section>
  `;
}

function calcProgress(){
  const total = JOINED_STATE.lessons.length;
  const doneCount = JOINED_STATE.progress.doneLessonIds.length;
  return { total, doneCount, pct: total ? Math.round((doneCount / total) * 100) : 0 };
}

function renderLessonList(){
  const activeId = String(JOINED_STATE.activeLessonId || "");
  $("lessonList").innerHTML = JOINED_STATE.lessons.map((lesson, index)=>{
    const active = activeId === String(lesson.id);
    const locked = lessonLocked(index);
    const quizPassed = lessonQuizResult(lesson.id)?.passed;
    return `
      <article class="course-row-card compact ${active ? "active" : ""}" data-lesson="${escapeHtml(lesson.id)}" style="${locked ? "opacity:.6" : ""}">
        <div class="course-row-main">
          <div class="course-chip-row">
            <span class="course-tag">${index + 1}-mavzu</span>
            <span class="course-tag">${escapeHtml(String(lesson.type || "").toUpperCase())}</span>
            ${lesson.quizEnabled ? `<span class="course-tag accent">${quizPassed ? "Quiz o'tildi" : "Quiz mavjud"}</span>` : ""}
            ${lessonDone(lesson.id) ? `<span class="course-tag success">Tugadi</span>` : ""}
            ${locked ? `<span class="course-tag danger">Bloklangan</span>` : ""}
          </div>
          <h3 class="course-row-title" style="margin-top:12px">${escapeHtml(lesson.title)}</h3>
          <div class="course-row-copy">${escapeHtml(shortText(lesson.text || "Video, PDF yoki matn ko'rinishida tushuntiriladi.", 110))}</div>
        </div>
      </article>
    `;
  }).join("");

  $("lessonList").querySelectorAll("[data-lesson]").forEach((card)=>{
    card.addEventListener("click", ()=>{
      const lesson = JOINED_STATE.lessons.find((item)=> String(item.id) === String(card.dataset.lesson));
      const index = JOINED_STATE.lessons.findIndex((item)=> String(item.id) === String(card.dataset.lesson));
      if(index >= 0 && lessonLocked(index)){
        setAlert("error", "Oldingi mavzuni tugatmasdan keyingisiga o'tib bo'lmaydi.");
        return;
      }
      openLesson(card.dataset.lesson);
    });
  });
}

function renderTests(){
  const tests = JOINED_STATE.tests || [];
  $("courseTests").innerHTML = tests.length ? tests.map((test)=> `
    <article class="course-row-card compact">
      <div class="course-row-main">
        <div class="course-chip-row">
          <span class="course-tag">${escapeHtml(test.phase === "during" ? "Jarayon testi" : "Yakuniy test")}</span>
          ${test.isFinal ? `<span class="course-tag warn">Final</span>` : ""}
        </div>
        <h3 class="course-row-title" style="margin-top:10px">${escapeHtml(test.title || "Test")}</h3>
        <div class="course-row-copy">${escapeHtml("O'tish foizi: " + Number(test.passPct || 60) + "%")}</div>
      </div>
      <a class="course-link-button" href="/test.html?id=${encodeURIComponent(test.id)}&courseId=${encodeURIComponent(JOINED_STATE.course.id)}">${iconSpan("play")}Ochish</a>
    </article>
  `).join("") : `<div class="course-empty">Bu kursga hali umumiy test bog'lanmagan.</div>`;
}

function renderMaterialPreview(url, mime){
  const safeUrl = String(url || "").trim();
  if(!safeUrl) return `<div class="course-empty">Tanlangan material yo'q.</div>`;
  const type = String(mime || "").toLowerCase();
  if(type.includes("pdf") || safeUrl.toLowerCase().endsWith(".pdf")){
    return `<div class="course-media" style="min-height:420px"><iframe src="${escapeHtml(safeUrl)}"></iframe></div>`;
  }
  if(type.startsWith("video/")){
    return `<div class="course-media"><video src="${escapeHtml(safeUrl)}" controls playsinline preload="metadata"></video></div>`;
  }
  if(type.startsWith("image/")){
    return `<div class="course-media"><img src="${escapeHtml(safeUrl)}" alt="material"></div>`;
  }
  return `<div class="course-card tight"><a class="course-link-button primary" target="_blank" rel="noopener" href="${escapeHtml(safeUrl)}">${iconSpan("upload")}Materialni ochish</a></div>`;
}

function renderViewer(){
  const lesson = JOINED_STATE.lessons.find((item)=> String(item.id) === String(JOINED_STATE.activeLessonId));
  if(!lesson){
    $("viewerArea").innerHTML = `<div class="course-empty">Chap tomondan mavzu tanlang.</div>`;
    return;
  }
  const media = mediaForLesson(lesson);
  const quizResult = lessonQuizResult(lesson.id);
  const role = String(JOINED_STATE.me.role || "student").toLowerCase();
  const studentMode = role === "student";
  const canMarkDone = studentMode;
  const materials = Array.isArray(lesson.materials) ? lesson.materials : [];

  $("viewerArea").innerHTML = `
    <section class="course-card">
      <div class="course-chip-row">
        <span class="course-tag">${escapeHtml(String(lesson.type || "").toUpperCase())}</span>
        ${lesson.durationMinutes ? `<span class="course-tag">${lesson.durationMinutes} min</span>` : ""}
        ${lesson.quizEnabled ? `<span class="course-tag accent">Qisqa test</span>` : ""}
        ${lessonDone(lesson.id) ? `<span class="course-tag success">Mavzu yakunlangan</span>` : ""}
      </div>
      <h2 class="course-section-title" style="margin-top:16px">${escapeHtml(lesson.title)}</h2>
      <div class="course-muted" style="margin-top:10px">${escapeHtml(shortText(lesson.text || "Asosiy material quyida ko'rsatiladi.", 240))}</div>
      <div style="margin-top:18px">
        ${media.type === "embed" ? `<div class="course-media"><iframe src="${escapeHtml(media.src)}" allowfullscreen></iframe></div>` : ""}
        ${media.type === "video" ? `<div class="course-media"><video src="${escapeHtml(media.src)}" controls playsinline preload="metadata"></video></div>` : ""}
        ${media.type === "pdf" ? `<div class="course-media" style="min-height:520px"><iframe src="${escapeHtml(media.src)}"></iframe></div>` : ""}
        ${media.type === "text" ? `<div class="course-card tight" style="margin-top:12px;white-space:pre-wrap;line-height:1.7">${escapeHtml(lesson.text || "Matnli material kiritilmagan.")}</div>` : ""}
      </div>
      <div class="course-inline-actions" style="margin-top:16px">
        ${canMarkDone ? `<button class="course-button primary" id="markDoneBtn">${iconSpan("check")}Tugatdim</button>` : ""}
        <button class="course-button" id="nextLessonBtn">${iconSpan("arrowRight")}Keyingi mavzu</button>
      </div>
    </section>

    <section class="course-card section-gap">
      <div class="course-split">
        <div>
          <h2 class="course-section-title">Materiallar</h2>
          <div class="course-stack" style="margin-top:16px">
            ${materials.length ? materials.map((material)=> `
              <article class="course-row-card compact">
                <div class="course-row-main">
                  <h3 class="course-row-title">${escapeHtml(material.name || "material")}</h3>
                  <div class="course-row-copy">${escapeHtml(material.mimeType || "Fayl")}</div>
                </div>
                <div class="course-inline-actions">
                  <button class="course-button" data-material="${escapeHtml(material.url || "")}" data-mime="${escapeHtml(material.mimeType || "")}">${iconSpan("eye")}Preview</button>
                  <a class="course-link-button" target="_blank" rel="noopener" href="${escapeHtml(material.url || "#")}">${iconSpan("upload")}Yuklash</a>
                </div>
              </article>
            `).join("") : `<div class="course-empty">Bu mavzu uchun qo'shimcha material hozircha yo'q.</div>`}
          </div>
        </div>
        <div>
          <h2 class="course-section-title">Preview</h2>
          <div id="materialPreviewBox" style="margin-top:16px">
            ${JOINED_STATE.selectedMaterialUrl ? renderMaterialPreview(JOINED_STATE.selectedMaterialUrl, materials.find((item)=> item.url === JOINED_STATE.selectedMaterialUrl)?.mimeType || "") : `<div class="course-empty">Materialni preview qilish uchun chapdagi tugmani bosing.</div>`}
          </div>
        </div>
      </div>
    </section>

    <section class="course-card section-gap">
      <h2 class="course-section-title">Mavzu testi</h2>
      <div class="course-muted" style="margin-top:10px">${lesson.quizEnabled ? "Ustoz biriktirgan qisqa test. Mavzuni tugatish uchun undan o'ting." : "Bu mavzu uchun alohida qisqa test biriktirilmagan."}</div>
      ${lesson.quizEnabled ? `
        <div class="course-surface-note" style="margin-top:16px">
          ${quizResult ? `Oxirgi natija: ${quizResult.lastScore || 0}% | Eng yaxshi natija: ${quizResult.bestScore || 0}% | Urinishlar: ${quizResult.attempts || 0}` : "Quiz hali ishlanmagan."}
        </div>
        <div id="lessonQuizWrap" class="course-stack" style="margin-top:18px">
          ${lesson.quizQuestions.map((question, index)=> `
            <article class="course-quiz-question">
              <div class="course-chip-row"><span class="course-tag">${index + 1}-savol</span></div>
              <h3 class="course-row-title" style="margin-top:12px">${escapeHtml(question.text || "")}</h3>
              <div class="course-option-grid" style="margin-top:14px">
                ${(question.options || []).map((option)=> `
                  <label class="course-row-card compact" style="cursor:pointer">
                    <input type="radio" name="quiz_${escapeHtml(question.id || String(index))}" value="${escapeHtml(option.key || "")}">
                    <span>${escapeHtml(option.key || "")}. ${escapeHtml(option.text || "")}</span>
                  </label>
                `).join("")}
              </div>
            </article>
          `).join("")}
        </div>
        <div class="course-inline-actions" style="margin-top:16px">
          ${studentMode ? `<button class="course-button primary" id="submitQuizBtn">${iconSpan("check")}Quizni topshirish</button>` : ""}
        </div>
        <div id="quizFeedbackBox" style="margin-top:16px">
          ${quizResult ? `<div class="course-surface-note">Eng yaxshi natijangiz: ${quizResult.bestScore || 0}%</div>` : ""}
        </div>
      ` : `<div class="course-empty" style="margin-top:16px">Bu mavzu uchun alohida lesson quiz yo'q.</div>`}
    </section>
  `;

  if($("markDoneBtn")){
    $("markDoneBtn").addEventListener("click", markCurrentDone);
  }
  $("nextLessonBtn").addEventListener("click", openNextLesson);
  $("viewerArea").querySelectorAll("[data-material]").forEach((button)=>{
    button.addEventListener("click", ()=>{
      JOINED_STATE.selectedMaterialUrl = button.dataset.material || "";
      const mime = button.dataset.mime || "";
      $("materialPreviewBox").innerHTML = renderMaterialPreview(JOINED_STATE.selectedMaterialUrl, mime);
    });
  });
  if($("submitQuizBtn")){
    $("submitQuizBtn").addEventListener("click", submitLessonQuiz);
  }

  renderCertificateButton();
}

function renderCertificateButton(){
  const progress = calcProgress();
  const certificateWrap = $("certificateWrap");
  if(!isStudent()){
    certificateWrap.innerHTML = "";
    return;
  }
  const canOpen = progress.pct >= 100 && JOINED_STATE.progress.testPassed;
  certificateWrap.innerHTML = canOpen
    ? `<a class="course-link-button primary" href="/certificate.html?courseId=${encodeURIComponent(JOINED_STATE.course.id)}">${iconSpan("check")}Sertifikat olish</a>`
    : `<div class="course-surface-note">Sertifikat uchun progress 100% va yakuniy test talabi bajarilishi kerak.</div>`;
}

function openLesson(id){
  JOINED_STATE.activeLessonId = String(id);
  JOINED_STATE.selectedMaterialUrl = "";
  renderLessonList();
  renderViewer();
}

function openNextLesson(){
  const currentIndex = JOINED_STATE.lessons.findIndex((item)=> String(item.id) === String(JOINED_STATE.activeLessonId));
  if(currentIndex < 0) return;
  const next = JOINED_STATE.lessons[currentIndex + 1];
  if(!next){
    setAlert("success", "Bu oxirgi mavzu.");
    return;
  }
  if(lessonLocked(currentIndex + 1)){
    setAlert("error", "Keyingi mavzu oldingisi tugagandan keyin ochiladi.");
    return;
  }
  openLesson(next.id);
}

async function markCurrentDone(){
  const lesson = JOINED_STATE.lessons.find((item)=> String(item.id) === String(JOINED_STATE.activeLessonId));
  if(!lesson) return;
  const quizResult = lessonQuizResult(lesson.id);
  if(lesson.quizEnabled && !quizResult?.passed){
    setAlert("error", "Bu mavzuni tugatish uchun avval qisqa testdan o'ting.");
    return;
  }
  try{
    await apiFetch(`/api/progress/${encodeURIComponent(JOINED_STATE.course.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentId: lesson.id, done: true, lastLessonId: lesson.id })
    });
    if(!lessonDone(lesson.id)) JOINED_STATE.progress.doneLessonIds.push(String(lesson.id));
    renderHeader();
    renderLessonList();
    renderViewer();
    setAlert("success", "Mavzu yakunlangan deb belgilandi.");
  }catch(error){
    setAlert("error", error.message || "Progress saqlanmadi.");
  }
}

async function submitLessonQuiz(){
  const lesson = JOINED_STATE.lessons.find((item)=> String(item.id) === String(JOINED_STATE.activeLessonId));
  if(!lesson || !lesson.quizEnabled) return;
  const answers = {};
  lesson.quizQuestions.forEach((question, index)=>{
    const checked = document.querySelector(`input[name="quiz_${question.id || index}"]:checked`);
    answers[question.id] = checked ? checked.value : "";
  });
  try{
    clearAlert();
    const data = await apiFetch(`/api/courses/${encodeURIComponent(JOINED_STATE.course.id)}/content/${encodeURIComponent(lesson.id)}/lesson-quiz/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers })
    });
    const result = data?.result || {};
    JOINED_STATE.progress.lessonQuizResults[String(lesson.id)] = {
      bestScore: Math.max(Number(lessonQuizResult(lesson.id)?.bestScore || 0), Number(result.score || 0)),
      lastScore: Number(result.score || 0),
      attempts: Number(result.attempts || 0),
      passed: !!result.passed
    };
    const reviewHtml = (result.review || []).map((item)=> `
      <article class="course-row-card compact">
        <div class="course-row-main">
          <h3 class="course-row-title">${escapeHtml(item.text || "")}</h3>
          <div class="course-row-copy" style="margin-top:8px">${escapeHtml("Sizning javobingiz: " + (item.yourAnswer || "tanlanmagan"))}</div>
          <div class="course-row-copy">${escapeHtml("To'g'ri javob: " + (item.correctKey || ""))}</div>
          ${item.explanation ? `<div class="course-row-copy">${escapeHtml(item.explanation)}</div>` : ""}
        </div>
      </article>
    `).join("");
    $("quizFeedbackBox").innerHTML = `
      <div class="course-surface-note">
        Natija: ${result.score || 0}% | To'g'ri: ${result.correct || 0}/${result.total || 0} | O'tish me'yori: ${result.passPct || 60}%
      </div>
      <div class="course-stack" style="margin-top:12px">${reviewHtml}</div>
    `;
    renderLessonList();
    setAlert(result.passed ? "success" : "error", result.passed ? "Quizdan o'tdingiz. Endi mavzuni tugatishingiz mumkin." : "Quizdan o'tmadingiz, yana urinib ko'ring.");
  }catch(error){
    setAlert("error", error.message || "Quiz yuborilmadi.");
  }
}

async function loadTests(){
  try{
    const data = await apiFetch(`/api/courses/${encodeURIComponent(JOINED_STATE.course.id)}/tests`);
    JOINED_STATE.tests = Array.isArray(data?.tests) ? data.tests.map((item)=> ({
      id: String(item._id || item.id || ""),
      title: item.title || "Test",
      phase: item.phase || "after",
      isFinal: !!item.isFinal,
      passPct: Number(item.passPct || 60)
    })) : [];
  }catch(_){
    JOINED_STATE.tests = [];
  }
  renderTests();
}

async function loadProgress(){
  try{
    const data = await apiFetch(`/api/progress/${encodeURIComponent(JOINED_STATE.course.id)}`);
    JOINED_STATE.progress = {
      doneLessonIds: Array.isArray(data?.doneLessonIds) ? data.doneLessonIds.map(String) : [],
      testPassed: !!data?.testPassed,
      lessonQuizResults: data?.lessonQuizResults && typeof data.lessonQuizResults === "object" ? data.lessonQuizResults : {},
      lastLessonId: String(data?.lastLessonId || "")
    };
  }catch(_){
    JOINED_STATE.progress = { doneLessonIds: [], testPassed: false, lessonQuizResults: {}, lastLessonId: "" };
  }
}

async function loadCourse(){
  const courseId = qs("id");
  if(!courseId){
    setAlert("error", "Kurs ID topilmadi.");
    return;
  }
  const data = await apiFetch(`/api/courses/${encodeURIComponent(courseId)}`);
  JOINED_STATE.course = normalizeCourse(data?.course || data);
  const content = await apiFetch(`/api/courses/${encodeURIComponent(courseId)}/content`);
  JOINED_STATE.lessons = (Array.isArray(content?.items) ? content.items : []).map(normalizeLesson);
  await Promise.all([loadProgress(), loadTests()]);
  renderHeader();
  renderLessonList();
  renderTests();
  const preferredLesson = JOINED_STATE.progress.lastLessonId && JOINED_STATE.lessons.some((item)=> String(item.id) === String(JOINED_STATE.progress.lastLessonId))
    ? JOINED_STATE.progress.lastLessonId
    : JOINED_STATE.lessons[0]?.id;
  if(preferredLesson) openLesson(preferredLesson);
}

async function init(){
  initStoredTheme();
  applyTheme($("themeBtn"));
  $("logoutBtn").addEventListener("click", logout);
  JOINED_STATE.me = await getMe();
  if(!JOINED_STATE.me) return;
  renderHeaderMeta(JOINED_STATE.me, { roleBadge: "roleBadge", mePill: "mePill", dashboardLink: "dashboardLink" });
  await loadCourse();
}

init().catch((error)=>{
  setAlert("error", error.message || "Kurs sahifasi yuklanmadi.");
});
