(function () {
  "use strict";
  var catalog;
  var currentCourse;
  var currentChapter;
  var switcher = document.getElementById("courseSwitcher");
  var chapterNav = document.getElementById("chapterNav");
  var main = document.getElementById("courseMain");

  function choose(courseId, chapterId, push) {
    currentCourse = catalog.courses.find(function (item) { return item.id === courseId; }) || catalog.courses[0];
    currentChapter = currentCourse.chapters.find(function (item) { return item.id === chapterId; }) || currentCourse.chapters[0];
    renderNavigation();
    renderChapter();
    if (push !== false) {
      var params = new URLSearchParams({ course: currentCourse.id, chapter: currentChapter.id });
      history.replaceState(null, "", "?" + params.toString());
    }
  }

  function renderNavigation() {
    switcher.innerHTML = catalog.courses.map(function (course) {
      return '<button type="button" data-course="' + CourseContent.escapeHtml(course.id) + '" class="' + (course.id === currentCourse.id ? "active" : "") + '"><span class="course-icon">' + CourseContent.escapeHtml(course.icon) + '</span><span><strong>' + CourseContent.escapeHtml(course.shortTitle) + '</strong><small>' + course.chapters.length + " 个章节</small></span></button>";
    }).join("");
    chapterNav.innerHTML = currentCourse.chapters.map(function (chapter, index) {
      return '<a href="?course=' + encodeURIComponent(currentCourse.id) + '&chapter=' + encodeURIComponent(chapter.id) + '" data-chapter="' + CourseContent.escapeHtml(chapter.id) + '" class="' + (chapter.id === currentChapter.id ? "active" : "") + '"><span class="chapter-number">' + String(index + 1).padStart(2, "0") + '</span><span>' + CourseContent.escapeHtml(chapter.title.replace(/^第.+?：/, "")) + "</span></a>";
    }).join("");
  }

  async function renderChapter() {
    var courseAtRequest = currentCourse;
    var chapterAtRequest = currentChapter;
    main.innerHTML = '<div class="portal-card loading">正在加载章节…</div>';
    var markdown;
    try {
      var response = await fetch(chapterAtRequest.content, { cache: "no-cache" });
      if (!response.ok) throw new Error("missing");
      markdown = await response.text();
    } catch (_) { markdown = "# 资料整理中\n\n本章的正式资料尚未上传。负责人可以在仓库中添加对应 Markdown 文件后发布。"; }
    if (courseAtRequest !== currentCourse || chapterAtRequest !== currentChapter) return;
    var assignment = chapterAtRequest.assignment;
    main.innerHTML = '<section class="portal-card course-overview"><span class="eyebrow">' + CourseContent.escapeHtml(courseAtRequest.id.toUpperCase()) + '</span><h2>' + CourseContent.escapeHtml(courseAtRequest.title) + '</h2><p>' + CourseContent.escapeHtml(courseAtRequest.summary) + '</p><div class="course-meta"><span class="chip">' + CourseContent.escapeHtml(courseAtRequest.level) + '</span><span class="chip">' + CourseContent.escapeHtml(courseAtRequest.duration) + '</span><span class="chip">' + courseAtRequest.chapters.length + ' 个章节</span></div></section>' +
      '<article class="portal-card markdown-body">' + CourseContent.renderMarkdown(markdown) + (assignment ? '<aside class="assignment-callout"><span class="chip">本章作业</span><h3>' + CourseContent.escapeHtml(assignment.title) + '</h3><p>' + CourseContent.escapeHtml(assignment.description) + '</p><a class="btn btn-primary btn-lg" href="account.html?assignment=' + encodeURIComponent(assignment.id) + '">前往提交作业</a></aside>' : "") + "</article>";
  }

  switcher.addEventListener("click", function (event) {
    var button = event.target.closest("[data-course]");
    if (button) choose(button.dataset.course, null, true);
  });
  chapterNav.addEventListener("click", function (event) {
    var link = event.target.closest("[data-chapter]");
    if (link) { event.preventDefault(); choose(currentCourse.id, link.dataset.chapter, true); }
  });

  async function init() {
    if (!AIClub.configured()) document.getElementById("setupNotice").classList.remove("hidden");
    else {
      try {
        var active = await AIClub.session(false);
        if (active) document.getElementById("accountLink").textContent = "我的作业";
      } catch (_) { /* 课程不受认证状态影响 */ }
    }
    try {
      catalog = await CourseContent.loadCatalog();
      var params = new URLSearchParams(location.search);
      choose(params.get("course"), params.get("chapter"), false);
    } catch (err) {
      main.innerHTML = '<div class="notice error">' + CourseContent.escapeHtml(err.message) + "</div>";
    }
  }
  init();
})();
