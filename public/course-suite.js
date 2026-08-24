(function(){
  const API_BASE = "";

  function $(id){ return document.getElementById(id); }
  function qs(name){ return new URLSearchParams(window.location.search).get(name); }
  function getToken(){ return localStorage.getItem("token") || ""; }
  function escapeHtml(value){
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function money(value){
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return "0 so'm";
    return amount.toLocaleString("uz-UZ") + " so'm";
  }

  function formatDate(value){
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("uz-UZ", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function shortText(value, max = 180){
    const text = String(value || "").trim();
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  }

  function youtubeEmbed(url){
    if(!url) return "";
    try{
      const u = new URL(url);
      let id = "";
      if(u.hostname.includes("youtu.be")) id = u.pathname.replace("/", "");
      else if(u.searchParams.get("v")) id = u.searchParams.get("v");
      else if(u.pathname.includes("/embed/")) id = u.pathname.split("/embed/")[1];
      if(!id) return "";
      return "https://www.youtube.com/embed/" + id;
    }catch(_){
      return "";
    }
  }

  function genericEmbed(url){
    const raw = String(url || "").trim();
    if(!raw) return "";
    const yt = youtubeEmbed(raw);
    if(yt) return yt;
    try{
      const u = new URL(raw);
      const host = String(u.hostname || "").toLowerCase();
      if(host.includes("vimeo.com")){
        const id = u.pathname.split("/").filter(Boolean).pop();
        if(id) return "https://player.vimeo.com/video/" + id;
      }
      if(host.includes("drive.google.com")){
        const match = raw.match(/\/file\/d\/([^/]+)/);
        if(match && match[1]) return "https://drive.google.com/file/d/" + match[1] + "/preview";
      }
      if(u.pathname.includes("/embed/") || host.startsWith("player.") || host.includes("embed")) return raw;
    }catch(_){}
    return "";
  }

  async function apiFetch(url, options = {}){
    const headers = Object.assign({}, options.headers || {});
    const token = getToken();
    if(token) headers.Authorization = "Bearer " + token;
    const response = await fetch(API_BASE + url, Object.assign({}, options, { headers }));
    const contentType = response.headers.get("content-type") || "";
    let payload = null;
    try{
      payload = contentType.includes("application/json") ? await response.json() : await response.text();
    }catch(_){
      payload = null;
    }
    if(!response.ok){
      const message = (payload && payload.error) ? payload.error : ("So'rov xatosi: " + response.status);
      const error = new Error(message);
      error.status = response.status;
      error.data = payload;
      throw error;
    }
    return payload;
  }

  async function getMe(){
    const token = getToken();
    if(!token){
      window.location.href = "/login.html";
      return null;
    }
    try{
      return await apiFetch("/api/me");
    }catch(_){
      localStorage.removeItem("token");
      window.location.href = "/login.html";
      return null;
    }
  }

  function applyTheme(button){
    if(button){
      button.addEventListener("click", ()=>{
        document.documentElement.classList.toggle("dark");
        localStorage.setItem("theme", document.documentElement.classList.contains("dark") ? "dark" : "light");
      });
    }
  }

  function initStoredTheme(){
    const key = "theme";
    const saved = localStorage.getItem(key);
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const mode = saved || (prefersDark ? "dark" : "light");
    if(mode === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }

  function logout(){
    localStorage.removeItem("token");
    window.location.href = "/login.html";
  }

  function roleBadgeText(role){
    const normalized = String(role || "student").toLowerCase();
    if(normalized === "teacher") return "TEACHER";
    if(normalized === "admin") return "ADMIN";
    return "STUDENT";
  }

  function dashHref(role){
    const normalized = String(role || "student").toLowerCase();
    if(normalized === "teacher") return "/teacher-dashboard.html";
    if(normalized === "tutor") return "/tutor-dashboard.html";
    if(normalized === "admin") return "/admin-dashboard.html";
    return "/student-dashboard.html";
  }

  function displayName(me){
    return me?.fullname || me?.fullName || me?.name || me?.username || "Foydalanuvchi";
  }

  function displayGroup(me){
    return me?.group || me?.studyGroup || "";
  }

  function renderHeaderMeta(me, ids = {}){
    const role = String(me?.role || "student").toLowerCase();
    if(ids.roleBadge && $(ids.roleBadge)){
      $(ids.roleBadge).textContent = roleBadgeText(role);
      $(ids.roleBadge).className = "course-pill course-role-pill";
    }
    if(ids.mePill && $(ids.mePill)){
      const bits = [displayName(me), me?.faculty || "", displayGroup(me)].filter(Boolean);
      $(ids.mePill).textContent = bits.join(" • ");
    }
    if(ids.dashboardLink && $(ids.dashboardLink)){
      $(ids.dashboardLink).href = dashHref(role);
    }
  }

  function icon(name){
    const icons = {
      moon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>',
      logout:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
      course:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5"/><path d="M8 7h8"/><path d="M8 11h8"/></svg>',
      chart:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>',
      users:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      star:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.48 3.5a.56.56 0 0 1 1.04 0l2.1 5.37a.56.56 0 0 0 .46.35l5.74.42a.56.56 0 0 1 .32.98l-4.38 3.68a.56.56 0 0 0-.18.56l1.36 5.58a.56.56 0 0 1-.84.61L12.3 18a.56.56 0 0 0-.6 0l-4.8 3.05a.56.56 0 0 1-.84-.61l1.36-5.58a.56.56 0 0 0-.18-.56L2.86 10.62a.56.56 0 0 1 .32-.98l5.74-.42a.56.56 0 0 0 .46-.35z"/></svg>',
      play:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
      send:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/></svg>',
      check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>',
      message:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
      upload:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>',
      plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
      trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
      arrowRight:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 5 7 7-7 7"/></svg>',
      filter:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54z"/></svg>',
      copy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
      eye:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12"/><circle cx="12" cy="12" r="3"/></svg>',
      settings:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="m16.24 16.24 2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="m16.24 7.76 2.83-2.83"/><circle cx="12" cy="12" r="3"/></svg>',
      bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5"/><path d="M10 17a2 2 0 0 0 4 0"/></svg>'
    };
    return icons[name] || icons.course;
  }

  function iconSpan(name){
    return '<span class="course-icon" aria-hidden="true">' + icon(name) + '</span>';
  }

  function normalizeCourse(raw){
    const viewer = raw?.viewer || {};
    return {
      id: raw?._id || raw?.id || raw?.courseId || "",
      title: raw?.title || "Nomsiz kurs",
      description: raw?.description || "",
      type: raw?.type || "free",
      price: Number(raw?.price || 0),
      pricingCurrency: raw?.pricingCurrency || "UZS",
      status: raw?.status || "draft",
      visibility: raw?.visibility || "public",
      joinMode: raw?.joinMode || "open",
      allowComments: raw?.allowComments !== false,
      allowRatings: raw?.allowRatings !== false,
      allowSequential: raw?.allowSequential !== false,
      category: raw?.category || "",
      tags: Array.isArray(raw?.tags) ? raw.tags : [],
      studyDirections: Array.isArray(raw?.studyDirections) ? raw.studyDirections : [],
      level: raw?.level || "beginner",
      language: raw?.language || "uz",
      durationMinutes: Number(raw?.durationMinutes || 0),
      requirements: raw?.requirements || "",
      outcomes: raw?.outcomes || "",
      faculty: raw?.faculty || "",
      groups: Array.isArray(raw?.groups) ? raw.groups : [],
      youtubeUrl: raw?.youtubeUrl || "",
      coverUrl: raw?.coverUrl || "",
      previewMedia: raw?.previewMedia && typeof raw.previewMedia === "object" ? {
        contentId: raw.previewMedia.contentId || raw.previewMedia._id || "",
        type: raw.previewMedia.type || "",
        title: raw.previewMedia.title || "",
        youtubeUrl: raw.previewMedia.youtubeUrl || "",
        videoUrl: raw.previewMedia.videoUrl || "",
        durationMinutes: Number(raw.previewMedia.durationMinutes || 0),
        isPreview: !!raw.previewMedia.isPreview
      } : null,
      teacherId: raw?.teacherId || raw?.teacher?._id || "",
      teacherName: raw?.teacherName || raw?.teacher?.fullName || "",
      enrolledCount: Number(raw?.enrolledCount || 0),
      lessonCount: Number(raw?.lessonCount || 0),
      ratingAverage: Number(raw?.ratingAverage || 0),
      ratingCount: Number(raw?.ratingCount || 0),
      commentCount: Number(raw?.commentCount || 0),
      likeCount: Number(raw?.likeCount || 0),
      pendingRequests: Number(raw?.pendingRequests || 0),
      viewer: {
        joined: !!viewer.joined,
        requestStatus: viewer.requestStatus || "",
        pendingRequest: !!viewer.pendingRequest,
        requestId: viewer.requestId || "",
        myRating: Number(viewer.myRating || 0)
      },
      isOwner: !!raw?.isOwner,
      createdAt: raw?.createdAt || ""
    };
  }

  function normalizeLesson(raw, index = 0){
    return {
      id: raw?._id || raw?.id || ("lesson_" + index),
      order: Number(raw?.order || index + 1),
      title: raw?.title || ("Mavzu " + (index + 1)),
      type: raw?.type || "text",
      text: raw?.text || "",
      youtubeUrl: raw?.youtubeUrl || "",
      videoUrl: raw?.videoUrl || "",
      pdfUrl: raw?.pdfUrl || "",
      assetSizeBytes: Number(raw?.assetSizeBytes || 0),
      assetMimeType: raw?.assetMimeType || "",
      durationMinutes: Number(raw?.durationMinutes || 0),
      isPreview: !!raw?.isPreview,
      quizEnabled: !!raw?.quizEnabled,
      quizTitle: raw?.quizTitle || "",
      quizPassPct: Number(raw?.quizPassPct || 60),
      quizQuestions: Array.isArray(raw?.quizQuestions) ? raw.quizQuestions : [],
      materials: Array.isArray(raw?.materials) ? raw.materials : []
    };
  }

  function mediaForCourse(course){
    const url = String(course?.youtubeUrl || course?.videoUrl || "").trim();
    const embed = genericEmbed(url);
    if(embed) return { type: "embed", src: embed };
    if(url) return { type: "video", src: url };
    if(course?.coverUrl) return { type: "image", src: course.coverUrl };
    return { type: "placeholder", src: "" };
  }

  function mediaForLesson(lesson){
    const youtube = String(lesson?.youtubeUrl || "").trim();
    const video = String(lesson?.videoUrl || "").trim();
    const pdf = String(lesson?.pdfUrl || "").trim();
    const embed = genericEmbed(youtube || video);
    if(lesson?.type === "pdf" || pdf) return { type: "pdf", src: pdf };
    if(embed) return { type: "embed", src: embed };
    if(video || youtube) return { type: "video", src: video || youtube };
    return { type: "text", src: "" };
  }

  window.CourseSuite = {
    API_BASE,
    $,
    qs,
    getToken,
    escapeHtml,
    apiFetch,
    getMe,
    initStoredTheme,
    applyTheme,
    renderHeaderMeta,
    logout,
    icon,
    iconSpan,
    money,
    formatDate,
    shortText,
    youtubeEmbed,
    genericEmbed,
    normalizeCourse,
    normalizeLesson,
    mediaForCourse,
    mediaForLesson,
    displayName,
    displayGroup,
    dashHref
  };
})();
