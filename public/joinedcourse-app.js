const {
  $, qs, apiFetch, getMe, initStoredTheme, applyTheme, renderHeaderMeta, logout,
  iconSpan, normalizeCourse, normalizeLesson, escapeHtml, shortText, mediaForLesson, money
} = window.CourseSuite;

const JOINED_STATE = {
  me: null,
  course: null,
  lessons: [],
  tests: [],
  progress: {
    doneLessonIds: [],
    testPassed: false,
    requiredFinalTest: false,
    finalTestId: "",
    lessonQuizResults: {},
    lastLessonId: ""
  },
  activeLessonId: "",
  selectedMaterialUrl: "",
  certificate: null,
  certificateLoading: false
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

function roleName(){
  return String(JOINED_STATE.me?.role || "").toLowerCase();
}

function isStudent(){
  return roleName() === "student";
}

function lessonDone(id){
  return JOINED_STATE.progress.doneLessonIds.includes(String(id));
}

function lessonQuizResult(id){
  return JOINED_STATE.progress.lessonQuizResults?.[String(id)] || null;
}

function lessonById(id){
  return JOINED_STATE.lessons.find((item)=> String(item.id) === String(id)) || null;
}

function lessonIndexById(id){
  return JOINED_STATE.lessons.findIndex((item)=> String(item.id) === String(id));
}

function nextLessonAfter(id){
  const index = lessonIndexById(id);
  return index >= 0 ? (JOINED_STATE.lessons[index + 1] || null) : null;
}

function previousRequiredLesson(index){
  if(!JOINED_STATE.course?.allowSequential || !isStudent()) return null;
  if(index <= 0) return null;
  for(let i = 0; i < index; i += 1){
    const lesson = JOINED_STATE.lessons[i];
    if(lesson && !lessonDone(lesson.id)) return lesson;
  }
  return null;
}

function lessonLocked(index){
  return !!previousRequiredLesson(index);
}

function calcProgress(){
  const total = JOINED_STATE.lessons.length;
  const doneCount = JOINED_STATE.progress.doneLessonIds.length;
  return {
    total,
    doneCount,
    pct: total ? Math.round((doneCount / total) * 100) : 0
  };
}

function hasCertificateAccess(){
  const progress = calcProgress();
  if(!isStudent()) return false;
  if(progress.total < 1) return false;
  if(progress.pct < 100) return false;
  if(JOINED_STATE.progress.requiredFinalTest && !JOINED_STATE.progress.testPassed) return false;
  return true;
}

function displayName(){
  return JOINED_STATE.me?.fullname || JOINED_STATE.me?.fullName || JOINED_STATE.me?.name || JOINED_STATE.me?.username || "Student";
}

function facultyGroupText(){
  return [JOINED_STATE.me?.faculty, JOINED_STATE.me?.group || JOINED_STATE.me?.studyGroup].filter(Boolean).join(" • ");
}

function applyProgressPayload(data){
  if(!data || typeof data !== "object") return;
  JOINED_STATE.progress = {
    doneLessonIds: Array.isArray(data.doneLessonIds) ? data.doneLessonIds.map(String) : JOINED_STATE.progress.doneLessonIds,
    testPassed: !!data.testPassed,
    requiredFinalTest: !!data.requiredFinalTest,
    finalTestId: String(data.finalTestId || ""),
    lessonQuizResults: data.lessonQuizResults && typeof data.lessonQuizResults === "object"
      ? data.lessonQuizResults
      : JOINED_STATE.progress.lessonQuizResults,
    lastLessonId: String(data.lastLessonId || JOINED_STATE.progress.lastLessonId || "")
  };
}

function finalTestLink(){
  if(JOINED_STATE.progress.finalTestId){
    return `/test.html?id=${encodeURIComponent(JOINED_STATE.progress.finalTestId)}&courseId=${encodeURIComponent(JOINED_STATE.course.id)}`;
  }
  const finalTest = JOINED_STATE.tests.find((item)=> item.isFinal) || null;
  return finalTest ? `/test.html?id=${encodeURIComponent(finalTest.id)}&courseId=${encodeURIComponent(JOINED_STATE.course.id)}` : "";
}

function certificateLink(){
  if(JOINED_STATE.certificate?.certId){
    return `/certificate.html?verify=${encodeURIComponent(JOINED_STATE.certificate.certId)}`;
  }
  return `/certificate.html?courseId=${encodeURIComponent(JOINED_STATE.course.id)}`;
}

function optionTextFor(question, key){
  if(!question || !Array.isArray(question.options)) return "";
  const option = question.options.find((item)=> String(item.key || "") === String(key || ""));
  return option?.text || "";
}

function renderQuizFeedback(lesson, quizResult){
  if(!lesson?.quizEnabled){
    return `<div class="course-empty" style="margin-top:16px">Bu mavzu uchun alohida lesson quiz yo'q.</div>`;
  }
  if(!quizResult){
    return `
      <div class="course-surface-note">
        Quizni ishlagach natija shu yerda chiqadi. Tizim sizga qaysi javob to'g'ri, qaysi biri noto'g'ri ekanini aniq ko'rsatadi.
      </div>
    `;
  }

  const passed = !!quizResult.passed;
  const summary = `
    <div class="course-surface-note ${passed ? "success" : "danger"}">
      <strong>${passed ? "Quiz o'tildi." : "Quizdan o'tilmadi."}</strong>
      Natija: ${quizResult.lastScore || 0}% • Eng yaxshi: ${quizResult.bestScore || 0}% •
      To'g'ri: ${quizResult.correct || 0}/${quizResult.total || 0} •
      O'tish me'yori: ${quizResult.passPct || lesson.quizPassPct || 60}% •
      Urinishlar: ${quizResult.attempts || 0}
    </div>
  `;

  const review = Array.isArray(quizResult.review) ? quizResult.review : [];
  if(!review.length) return summary;

  const reviewHtml = review.map((item, index)=>{
    const question = lesson.quizQuestions.find((entry)=> String(entry.id || "") === String(item.questionId || "")) || lesson.quizQuestions[index] || null;
    const yourAnswer = item.yourAnswer || "";
    const correctKey = item.correctKey || "";
    const correct = yourAnswer && String(yourAnswer) === String(correctKey);
    const yourAnswerText = yourAnswer ? `${yourAnswer}. ${optionTextFor(question, yourAnswer) || ""}`.trim() : "Tanlanmagan";
    const correctText = correctKey ? `${correctKey}. ${optionTextFor(question, correctKey) || ""}`.trim() : correctKey;
    return `
      <article class="course-result-card ${correct ? "success" : "danger"}">
        <div class="course-chip-row">
          <span class="course-tag">${index + 1}-savol</span>
          <span class="course-tag ${correct ? "success" : "danger"}">${correct ? "To'g'ri" : "Noto'g'ri"}</span>
        </div>
        <h3 class="course-row-title" style="margin-top:12px">${escapeHtml(item.text || question?.text || "")}</h3>
        <div class="course-row-copy" style="margin-top:8px">Siz tanlagan javob: <strong>${escapeHtml(yourAnswerText)}</strong></div>
        <div class="course-row-copy">To'g'ri javob: <strong>${escapeHtml(correctText || "—")}</strong></div>
        ${item.explanation ? `<div class="course-row-copy">${escapeHtml(item.explanation)}</div>` : ""}
      </article>
    `;
  }).join("");

  return `
    ${summary}
    <div class="course-result-grid" style="margin-top:12px">${reviewHtml}</div>
  `;
}

function renderHeader(){
  const meCanTrack = roleName() === "admin" || JOINED_STATE.course.isOwner;
  const progress = calcProgress();
  $("heroArea").innerHTML = `
    <section class="course-card">
      <div class="course-split">
        <div>
          <div class="course-eyebrow">${iconSpan("play")}Kurs ichida ishlash</div>
          <h1 class="course-big-title" style="font-size:clamp(1.9rem, 1.2rem + 2vw, 3.8rem)">${escapeHtml(JOINED_STATE.course.title)}</h1>
          <p class="course-section-copy">${escapeHtml(JOINED_STATE.course.description || "Bu sahifada videodars, PDF materiallar va qisqa testlar tartibli va sodda oqimda ishlaydi.")}</p>
          <div class="course-chip-row">
            <span class="course-tag">${JOINED_STATE.lessons.length} mavzu</span>
            <span class="course-tag">${JOINED_STATE.course.allowSequential ? "Tartibli ochiladi" : "Hammasi ochiq"}</span>
            <span class="course-tag">${JOINED_STATE.tests.length} kurs testi</span>
            <span class="course-tag">${JOINED_STATE.course.type === "paid" ? escapeHtml(money(JOINED_STATE.course.price)) : "Bepul"}</span>
          </div>
          <div class="course-surface-note" style="margin-top:18px">
            ${isStudent()
              ? "Sodda tartib: mavzuni ko'rasiz, quiz bo'lsa topshirasiz, o'tsangiz dars avtomatik yakunlanadi va keyingisi ochiladi."
              : "Teacher/Admin preview rejimi. Bu yerda kurs oqimi talaba ko'rinishida tekshiriladi."}
          </div>
          <div class="course-inline-actions" style="margin-top:18px">
            <a class="course-link-button" href="/course.html?id=${encodeURIComponent(JOINED_STATE.course.id)}">${iconSpan("eye")}Kurs info</a>
            ${meCanTrack ? `<a class="course-link-button" href="/course-progress.html?id=${encodeURIComponent(JOINED_STATE.course.id)}">${iconSpan("chart")}Natijalar</a>` : ""}
            ${meCanTrack ? `<a class="course-link-button" href="/course-studio.html?id=${encodeURIComponent(JOINED_STATE.course.id)}">${iconSpan("settings")}Studio</a>` : ""}
          </div>
        </div>
        <div class="course-card tight">
          <div class="course-section-title">Progress</div>
          <div class="course-progress-bar" style="margin-top:14px"><span style="width:${progress.pct}%"></span></div>
          <div class="course-summary-grid" style="margin-top:16px">
            <div class="course-summary">
              <div class="course-muted">Foiz</div>
              <div class="course-summary-value">${progress.pct}%</div>
            </div>
            <div class="course-summary">
              <div class="course-muted">Tugagan</div>
              <div class="course-summary-value">${progress.doneCount}/${progress.total}</div>
            </div>
            <div class="course-summary">
              <div class="course-muted">Quizlar</div>
              <div class="course-summary-value">${Object.values(JOINED_STATE.progress.lessonQuizResults || {}).filter((item)=> item?.passed).length}</div>
            </div>
          </div>
          <div class="course-muted" style="margin-top:14px">
            ${JOINED_STATE.progress.requiredFinalTest
              ? (JOINED_STATE.progress.testPassed ? "Yakuniy test ham o'tilgan." : "Sertifikat ochilishi uchun yakuniy testdan ham o'tish kerak.")
              : "Bu kursda alohida yakuniy test majburiy emas."}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderLessonList(){
  const activeId = String(JOINED_STATE.activeLessonId || "");
  $("lessonList").innerHTML = JOINED_STATE.lessons.map((lesson, index)=>{
    const active = activeId === String(lesson.id);
    const blocker = previousRequiredLesson(index);
    const quizPassed = lessonQuizResult(lesson.id)?.passed;
    return `
      <article class="course-row-card compact ${active ? "active" : ""}" data-lesson="${escapeHtml(lesson.id)}" style="${blocker ? "opacity:.72" : ""}">
        <div class="course-row-main">
          <div class="course-chip-row">
            <span class="course-tag">${index + 1}-mavzu</span>
            <span class="course-tag">${escapeHtml(String(lesson.type || "").toUpperCase())}</span>
            ${lesson.quizEnabled ? `<span class="course-tag accent">${quizPassed ? "Quiz o'tildi" : "Quiz bor"}</span>` : ""}
            ${lessonDone(lesson.id) ? `<span class="course-tag success">Tugadi</span>` : ""}
            ${blocker ? `<span class="course-tag danger">${escapeHtml((blocker.order || index) + "-mavzu tugashi kerak")}</span>` : `<span class="course-tag">${lessonDone(lesson.id) ? "Ko'rildi" : "Ochiq"}</span>`}
          </div>
          <h3 class="course-row-title" style="margin-top:12px">${escapeHtml(lesson.title)}</h3>
          <div class="course-row-copy">${escapeHtml(shortText(lesson.text || "Video, PDF yoki matn ko'rinishida tushuntiriladi.", 110))}</div>
        </div>
      </article>
    `;
  }).join("");

  $("lessonList").querySelectorAll("[data-lesson]").forEach((card)=>{
    card.addEventListener("click", ()=>{
      const targetLessonId = String(card.dataset.lesson || "");
      const targetIndex = lessonIndexById(targetLessonId);
      const blocker = previousRequiredLesson(targetIndex);
      if(blocker){
        setAlert("error", `Avval "${blocker.title}" mavzusini tugating. Keyin keyingi mavzular ochiladi.`);
        openLesson(blocker.id);
        return;
      }
      openLesson(targetLessonId);
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
          ${test.isFinal ? `<span class="course-tag warn">Majburiy</span>` : ""}
          ${JOINED_STATE.progress.finalTestId && String(JOINED_STATE.progress.finalTestId) === String(test.id) && JOINED_STATE.progress.testPassed ? `<span class="course-tag success">O'tilgan</span>` : ""}
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
  const lesson = lessonById(JOINED_STATE.activeLessonId);
  if(!lesson){
    $("viewerArea").innerHTML = `<div class="course-empty">Chap tomondan mavzu tanlang.</div>`;
    renderCertificateButton();
    return;
  }

  const media = mediaForLesson(lesson);
  const quizResult = lessonQuizResult(lesson.id);
  const materials = Array.isArray(lesson.materials) ? lesson.materials : [];
  const canMarkDone = isStudent();
  const nextLesson = nextLessonAfter(lesson.id);
  const quizPassed = !lesson.quizEnabled || !!quizResult?.passed;
  const markDoneDisabled = !canMarkDone || (!quizPassed && !lessonDone(lesson.id)) || (!nextLesson && lessonDone(lesson.id));
  const markDoneLabel = lessonDone(lesson.id)
    ? (nextLesson ? "Keyingi mavzuga o'tish" : "Kurs tugadi")
    : (nextLesson ? "Mavzuni tugatib, keyingisiga o'tish" : "Mavzuni tugatish");

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
      <div class="course-surface-note" style="margin-top:16px">
        ${lesson.quizEnabled
          ? (quizPassed
            ? "Bu mavzu quizi o'tilgan. Endi dars avtomatik yakunlanadi yoki tugmani bosib keyingisiga o'tasiz."
            : "Bu mavzuda quiz bor. Avval quizni topshirasiz, tizim natijani ko'rsatadi va o'tsangiz keyingi mavzu ochiladi.")
          : "Bu mavzuda alohida quiz yo'q. Materialni ko'rib bo'lgach darsni tugatishingiz mumkin."}
      </div>
      <div style="margin-top:18px">
        ${media.type === "embed" ? `<div class="course-media"><iframe src="${escapeHtml(media.src)}" allowfullscreen></iframe></div>` : ""}
        ${media.type === "video" ? `<div class="course-media"><video src="${escapeHtml(media.src)}" controls playsinline preload="metadata"></video></div>` : ""}
        ${media.type === "pdf" ? `<div class="course-media" style="min-height:520px"><iframe src="${escapeHtml(media.src)}"></iframe></div>` : ""}
        ${media.type === "text" ? `<div class="course-card tight" style="margin-top:12px;white-space:pre-wrap;line-height:1.7">${escapeHtml(lesson.text || "Matnli material kiritilmagan.")}</div>` : ""}
      </div>
      <div class="course-inline-actions" style="margin-top:16px">
        ${canMarkDone ? `<button class="course-button primary" id="markDoneBtn" ${markDoneDisabled ? "disabled" : ""}>${iconSpan("check")}${markDoneLabel}</button>` : ""}
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
      <div class="course-muted" style="margin-top:10px">${lesson.quizEnabled ? `Bu mavzu uchun ${escapeHtml(lesson.quizTitle || "qisqa test")} biriktirilgan. O'tish me'yori: ${lesson.quizPassPct || 60}%.` : "Bu mavzu uchun alohida qisqa test biriktirilmagan."}</div>
      ${lesson.quizEnabled ? `
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
          ${isStudent() ? `<button class="course-button primary" id="submitQuizBtn">${iconSpan("check")}Quizni topshirish</button>` : ""}
        </div>
        <div id="quizFeedbackBox" style="margin-top:16px">${renderQuizFeedback(lesson, quizResult)}</div>
      ` : `<div class="course-empty" style="margin-top:16px">Bu mavzu uchun alohida lesson quiz yo'q.</div>`}
    </section>
  `;

  if($("markDoneBtn")){
    $("markDoneBtn").addEventListener("click", ()=> void markCurrentDone({ autoAdvance: true }));
  }
  $("nextLessonBtn").addEventListener("click", ()=> openNextLesson({ manual: true }));
  $("viewerArea").querySelectorAll("[data-material]").forEach((button)=>{
    button.addEventListener("click", ()=>{
      JOINED_STATE.selectedMaterialUrl = button.dataset.material || "";
      const mime = button.dataset.mime || "";
      $("materialPreviewBox").innerHTML = renderMaterialPreview(JOINED_STATE.selectedMaterialUrl, mime);
    });
  });
  if($("submitQuizBtn")){
    $("submitQuizBtn").addEventListener("click", ()=> void submitLessonQuiz());
  }

  renderCertificateButton();
}

function renderCertificateButton(){
  const certificateWrap = $("certificateWrap");
  if(!isStudent()){
    certificateWrap.innerHTML = "";
    return;
  }

  const progress = calcProgress();
  const remaining = Math.max(0, progress.total - progress.doneCount);
  if(hasCertificateAccess()){
    certificateWrap.innerHTML = `
      <section class="course-card">
        <div class="course-chip-row">
          <span class="course-tag success">Kurs yakunlandi</span>
          <span class="course-tag">${JOINED_STATE.certificate?.certId ? escapeHtml(JOINED_STATE.certificate.certId) : "Sertifikat tayyorlanmoqda"}</span>
        </div>
        <h2 class="course-section-title" style="margin-top:14px">Sertifikat tayyor</h2>
        <div class="course-muted" style="margin-top:10px">
          ${JOINED_STATE.certificate
            ? "Sertifikat noyob ID va QR bilan tayyor. Ochib PDF ko'rinishida yuklab olishingiz mumkin."
            : (JOINED_STATE.certificateLoading
              ? "Sertifikat generatsiya qilinmoqda. Bir necha soniya kuting."
              : "Sertifikat avtomatik tayyorlanmoqda. Bir necha soniya kuting.")}
        </div>
        <div class="course-inline-actions" style="margin-top:16px">
          <a class="course-link-button primary ${JOINED_STATE.certificate ? "" : "disabled"}" ${JOINED_STATE.certificate ? `href="${certificateLink()}"` : `aria-disabled="true"`}>${iconSpan("check")}Sertifikatni ochish</a>
          <a class="course-link-button" href="/certificate.html?courseId=${encodeURIComponent(JOINED_STATE.course.id)}">${iconSpan("eye")}Sahifada ko'rish</a>
        </div>
      </section>
    `;
    if(!JOINED_STATE.certificate && !JOINED_STATE.certificateLoading){
      void ensureCertificateRecord();
    }
    return;
  }

  const finalTestHref = finalTestLink();
  certificateWrap.innerHTML = `
    <section class="course-card">
      <div class="course-chip-row">
        <span class="course-tag">${progress.doneCount}/${progress.total} mavzu tugagan</span>
        ${JOINED_STATE.progress.requiredFinalTest ? `<span class="course-tag ${JOINED_STATE.progress.testPassed ? "success" : "warn"}">${JOINED_STATE.progress.testPassed ? "Final test o'tilgan" : "Final test kerak"}</span>` : ""}
      </div>
      <h2 class="course-section-title" style="margin-top:14px">Sertifikat ochilishi uchun</h2>
      <div class="course-muted" style="margin-top:10px">
        ${progress.pct < 100
          ? `Yana ${remaining} mavzuni tugatish kerak. Tizim oxirida sertifikatni avtomatik tayyorlaydi.`
          : "Barcha mavzular tugagan. Endi yakuniy testdan ham o'tsangiz sertifikat darrov tayyor bo'ladi."}
      </div>
      ${progress.pct >= 100 && JOINED_STATE.progress.requiredFinalTest && !JOINED_STATE.progress.testPassed && finalTestHref ? `
        <div class="course-inline-actions" style="margin-top:16px">
          <a class="course-link-button primary" href="${finalTestHref}">${iconSpan("play")}Yakuniy testni topshirish</a>
        </div>
      ` : ""}
    </section>
  `;
}

async function ensureCertificateRecord(){
  if(!hasCertificateAccess() || JOINED_STATE.certificateLoading || JOINED_STATE.certificate) return;
  JOINED_STATE.certificateLoading = true;
  renderCertificateButton();
  try{
    const data = await apiFetch("/api/certificates/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "course",
        sourceId: JOINED_STATE.course.id,
        fullName: displayName(),
        facultyGroup: facultyGroupText()
      })
    });
    JOINED_STATE.certificate = data?.certificate || null;
  }catch(error){
    console.error("Certificate generate error:", error);
  }
  JOINED_STATE.certificateLoading = false;
  renderCertificateButton();
}

function openLesson(id){
  JOINED_STATE.activeLessonId = String(id);
  JOINED_STATE.selectedMaterialUrl = "";
  renderLessonList();
  renderViewer();
}

function openNextLesson({ manual = false } = {}){
  const currentLesson = lessonById(JOINED_STATE.activeLessonId);
  const next = currentLesson ? nextLessonAfter(currentLesson.id) : null;
  if(!next){
    setAlert("success", "Bu oxirgi mavzu.");
    return;
  }
  const blocker = previousRequiredLesson(lessonIndexById(next.id));
  if(blocker){
    setAlert("error", `Avval "${blocker.title}" tugashi kerak. Keyingi mavzu shundan keyin ochiladi.`);
    openLesson(blocker.id);
    return;
  }
  openLesson(next.id);
  if(manual){
    setAlert("success", `${next.order || (lessonIndexById(next.id) + 1)}-mavzu ochildi.`);
  }
}

async function markCurrentDone({ autoAdvance = false, skipQuizCheck = false } = {}){
  const lesson = lessonById(JOINED_STATE.activeLessonId);
  if(!lesson) return;

  if(lessonDone(lesson.id)){
    if(autoAdvance){
      openNextLesson({ manual: true });
      return;
    }
    setAlert("success", "Bu mavzu allaqachon tugatilgan.");
    return;
  }

  if(lesson.quizEnabled && !skipQuizCheck && !lessonQuizResult(lesson.id)?.passed){
    setAlert("error", "Avval shu mavzuning quizidan o'ting. Tizim keyin darsni o'zi ochib beradi.");
    return;
  }

  try{
    clearAlert();
    const data = await apiFetch(`/api/progress/${encodeURIComponent(JOINED_STATE.course.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentId: lesson.id, done: true, lastLessonId: lesson.id })
    });
    applyProgressPayload(data);
    renderHeader();
    renderLessonList();

    if(autoAdvance){
      const next = nextLessonAfter(lesson.id);
      if(next){
        openLesson(next.id);
        setAlert("success", `"${lesson.title}" tugadi. "${next.title}" endi ochildi.`);
      }else{
        renderViewer();
        setAlert("success", `Kursning oxirgi mavzusi ham tugadi. ${hasCertificateAccess() ? "Sertifikat bo'limi ochildi." : "Endi yakuniy test bo'lsa, shuni topshiring."}`);
      }
    }else{
      renderViewer();
      setAlert("success", "Mavzu yakunlandi.");
    }

    if(hasCertificateAccess()){
      await ensureCertificateRecord();
    }
  }catch(error){
    setAlert("error", error.message || "Progress saqlanmadi.");
  }
}

async function submitLessonQuiz(){
  const lesson = lessonById(JOINED_STATE.activeLessonId);
  if(!lesson || !lesson.quizEnabled) return;

  const unanswered = [];
  const answers = {};
  lesson.quizQuestions.forEach((question, index)=>{
    const checked = document.querySelector(`input[name="quiz_${question.id || index}"]:checked`);
    if(!checked) unanswered.push(index + 1);
    answers[question.id] = checked ? checked.value : "";
  });

  if(unanswered.length){
    setAlert("error", `Avval barcha savollarga javob bering. To'ldirilmagan savollar: ${unanswered.join(", ")}.`);
    return;
  }

  const button = $("submitQuizBtn");
  if(button) button.disabled = true;

  try{
    clearAlert();
    const data = await apiFetch(`/api/courses/${encodeURIComponent(JOINED_STATE.course.id)}/content/${encodeURIComponent(lesson.id)}/lesson-quiz/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers })
    });
    const result = data?.result || {};
    const previous = lessonQuizResult(lesson.id) || {};
    JOINED_STATE.progress.lessonQuizResults[String(lesson.id)] = {
      bestScore: Math.max(Number(previous.bestScore || 0), Number(result.score || 0)),
      lastScore: Number(result.score || 0),
      attempts: Number(result.attempts || 0),
      passed: !!result.passed,
      correct: Number(result.correct || 0),
      total: Number(result.total || 0),
      passPct: Number(result.passPct || lesson.quizPassPct || 60),
      review: Array.isArray(result.review) ? result.review : []
    };

    $("quizFeedbackBox").innerHTML = renderQuizFeedback(lesson, JOINED_STATE.progress.lessonQuizResults[String(lesson.id)]);
    renderLessonList();
    renderHeader();

    if(result.passed){
      setAlert("success", "Quizdan o'tdingiz. Dars avtomatik yakunlanmoqda va keyingi mavzu ochiladi.");
      await markCurrentDone({ autoAdvance: true, skipQuizCheck: true });
      return;
    }

    setAlert("error", "Quizdan o'tilmadi. Tizim to'g'ri va noto'g'ri javoblarni quyida ko'rsatdi.");
  }catch(error){
    setAlert("error", error.message || "Quiz yuborilmadi.");
  }

  if(button) button.disabled = false;
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
    applyProgressPayload(data);
  }catch(_){
    JOINED_STATE.progress = {
      doneLessonIds: [],
      testPassed: false,
      requiredFinalTest: false,
      finalTestId: "",
      lessonQuizResults: {},
      lastLessonId: ""
    };
  }
}

function pickStartingLessonId(){
  const remembered = String(JOINED_STATE.progress.lastLessonId || "");
  if(remembered && lessonById(remembered)) return remembered;

  const firstOpenIncomplete = JOINED_STATE.lessons.find((lesson, index)=> !lessonDone(lesson.id) && !lessonLocked(index));
  if(firstOpenIncomplete) return firstOpenIncomplete.id;

  const firstLesson = JOINED_STATE.lessons[0];
  return firstLesson ? firstLesson.id : "";
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

  const preferredLessonId = pickStartingLessonId();
  if(preferredLessonId){
    openLesson(preferredLessonId);
  }else{
    $("viewerArea").innerHTML = `<div class="course-empty">Bu kursga hali mavzu qo'shilmagan.</div>`;
    renderCertificateButton();
  }

  if(hasCertificateAccess()){
    await ensureCertificateRecord();
  }
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
