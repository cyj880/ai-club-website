(function () {
  "use strict";
  var adminProfile;
  var catalog;
  var assignments = [];
  var profiles = [];
  var submissions = [];
  var attachments = [];
  var invites = [];

  function el(id) { return document.getElementById(id); }
  function esc(value) { return CourseContent.escapeHtml(value == null ? "" : value); }
  function formatDate(value) { return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
  function formatBytes(bytes) { return bytes < 1024 * 1024 ? Math.ceil(bytes / 1024) + " KB" : (bytes / 1024 / 1024).toFixed(1) + " MB"; }
  function showNotice(message, type) { el("adminNotice").textContent = message; el("adminNotice").className = "notice " + (type || ""); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function profileFor(id) { return profiles.find(function (item) { return item.id === id; }); }
  function assignmentFor(id) { return assignments.find(function (item) { return item.id === id; }); }

  // 从 B 站视频链接中提取 BV 号（严格校验，只允许 player.bilibili.com 作为 iframe 源）
  function bilibiliId(url) {
    if (!url) return null;
    var match = url.match(/bilibili\.com\/video\/(BV[0-9A-Za-z]{10})/i);
    return match ? match[1] : null;
  }

  // 链接区块：B 站视频内嵌播放器，其它链接保持普通跳转
  function renderLinkBlock(url) {
    if (!url) return "";
    var bv = bilibiliId(url);
    if (bv) {
      return '<div><strong>演示视频</strong><div class="video-embed"><iframe src="https://player.bilibili.com/player.html?bvid=' + bv + '&autoplay=0&danmaku=0&high_quality=1" title="演示视频" allowfullscreen scrolling="no"></iframe></div><p class="muted small">若播放器未显示，<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">点此在 B 站打开 ↗</a></p></div>';
    }
    return '<div><strong>链接</strong><p><a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + " ↗</a></p></div>";
  }
  function latestOnly(items) {
    var seen = new Set();
    return items.slice().sort(function (a, b) { return b.version - a.version; }).filter(function (item) {
      if (seen.has(item.user_id + ":" + item.assignment_id)) return false;
      seen.add(item.user_id + ":" + item.assignment_id);
      return true;
    });
  }

  async function loadData() {
    var results = await Promise.all([
      AIClub.db("profiles?select=id,email,full_name,student_id,major_class,qq,cohort_label,role,created_at,deletion_requested_at&order=created_at.desc", { method: "GET" }),
      AIClub.db("submissions?is_complete=eq.true&select=*&order=created_at.desc", { method: "GET" }),
      AIClub.db("attachments?select=*&order=created_at.asc", { method: "GET" }),
      AIClub.db("invitation_codes?select=id,cohort_label,is_active,created_at,disabled_at&order=created_at.desc", { method: "GET" }),
      CourseContent.loadCatalog()
    ]);
    catalog = results[4];
    assignments = CourseContent.assignments(catalog);
    profiles = results[0] || [];
    var allSubmissions = results[1] || [];
    var allAttachments = results[2] || [];
    submissions = latestOnly(allSubmissions);
    var keepIds = new Set(submissions.map(function (item) { return item.id; }));
    var oldIds = new Set(allSubmissions.filter(function (item) { return !keepIds.has(item.id); }).map(function (item) { return item.id; }));
    var oldPaths = allAttachments.filter(function (file) { return oldIds.has(file.submission_id); }).map(function (file) { return file.storage_path; });
    if (oldIds.size) {
      try {
        await AIClub.removeFiles(oldPaths);
        await AIClub.rpc("admin_prune_submission_history", {});
      } catch (_) { /* 清理失败不影响管理员查看最新提交，下次进入后台会重试 */ }
    }
    attachments = allAttachments.filter(function (file) { return keepIds.has(file.submission_id); });
    // 已从课程目录移除的任务不再计入负责人当前统计和作答列表，
    // 但其数据库记录与附件不做物理删除，便于必要时追溯。
    var activeAssignmentIds = new Set(assignments.map(function (item) { return item.id; }));
    submissions = submissions.filter(function (item) { return activeAssignmentIds.has(item.assignment_id); });
    var activeSubmissionIds = new Set(submissions.map(function (item) { return item.id; }));
    attachments = attachments.filter(function (file) { return activeSubmissionIds.has(file.submission_id); });
    invites = results[3] || [];
    renderAll();
  }

  function renderAll() {
    var students = profiles.filter(function (item) { return item.role !== "owner"; });
    var submitters = new Set(submissions.map(function (item) { return item.user_id; }));
    el("adminStats").innerHTML = '<div class="portal-card stat"><strong>' + students.length + '</strong><span>注册新生</span></div><div class="portal-card stat"><strong>' + submitters.size + '</strong><span>已提交新生</span></div><div class="portal-card stat"><strong>' + submissions.length + '</strong><span>当前提交数</span></div>';
    renderFilterOptions(); renderSubmissions(); renderStudents(); renderInvites(); renderDeletions();
  }

  function renderFilterOptions() {
    var selectedCohort = el("filterCohort").value;
    var cohorts = Array.from(new Set(profiles.map(function (p) { return p.cohort_label; }).filter(Boolean))).sort();
    el("filterCohort").innerHTML = '<option value="">全部届别</option>' + cohorts.map(function (value) { return '<option value="' + esc(value) + '">' + esc(value) + "</option>"; }).join("");
    el("filterCohort").value = selectedCohort;
    el("filterCourse").innerHTML = '<option value="">全部课程</option>' + catalog.courses.map(function (course) { return '<option value="' + esc(course.id) + '">' + esc(course.shortTitle) + "</option>"; }).join("");
    el("filterAssignment").innerHTML = '<option value="">全部任务</option>' + assignments.map(function (item) { return '<option value="' + esc(item.id) + '" data-course="' + esc(item.courseId) + '">' + esc(item.title) + "</option>"; }).join("");
  }

  function renderSubmissions() {
    var cohort = el("filterCohort").value;
    var course = el("filterCourse").value;
    var assignment = el("filterAssignment").value;
    var query = el("filterStudent").value.trim().toLowerCase();
    var filtered = submissions.filter(function (item) {
      var student = profileFor(item.user_id);
      if (!student) return false;
      var haystack = [student.full_name, student.student_id, student.major_class].join(" ").toLowerCase();
      return (!cohort || student.cohort_label === cohort) && (!course || item.course_id === course) && (!assignment || item.assignment_id === assignment) && (!query || haystack.indexOf(query) >= 0);
    });
    el("adminSubmissionList").innerHTML = filtered.length ? filtered.map(function (item) {
      var student = profileFor(item.user_id); var task = assignmentFor(item.assignment_id);
      return '<article class="portal-card admin-row"><div><div class="student-name">' + esc(student.full_name) + '</div><div class="student-detail">' + esc(student.student_id) + " · " + esc(student.major_class) + " · " + esc(student.cohort_label) + '</div></div><div><strong>' + esc(task ? task.title : item.assignment_id) + '</strong><div class="student-detail">' + esc(task ? task.courseTitle : item.course_id) + '</div></div><div><span class="status submitted">已提交</span><div class="student-detail">' + formatDate(item.created_at) + '</div></div><button class="btn btn-outline" type="button" data-view-submission="' + esc(item.id) + '">查看作答</button></article>';
    }).join("") : '<div class="portal-card empty">当前筛选条件下没有提交记录。</div>';
  }

  function roleBadge(role) {
    if (role === "admin") return '<span class="status submitted">管理员</span>';
    return '<span class="status unsubmitted">成员</span>';
  }

  function renderStudents() {
    var students = profiles.filter(function (item) { return item.role !== "owner"; });
    var isOwner = adminProfile && adminProfile.role === "owner";
    el("studentList").innerHTML = students.length ? students.map(function (student) {
      var own = submissions.filter(function (item) { return item.user_id === student.id; });
      var taskCount = new Set(own.map(function (item) { return item.assignment_id; })).size;
      var manage = "";
      if (isOwner) {
        manage = student.role === "admin"
          ? '<button class="text-button" type="button" data-set-role="' + esc(student.id) + '|student">移除管理员</button>'
          : '<button class="text-button" type="button" data-set-role="' + esc(student.id) + '|admin">设为管理员</button>';
      }
      return '<article class="portal-card admin-row"><div><div class="student-name">' + esc(student.full_name) + '</div><div class="student-detail">' + esc(student.email) + '</div></div><div><strong>' + esc(student.student_id) + '</strong><div class="student-detail">' + esc(student.major_class) + " · QQ " + esc(student.qq) + '</div></div><div>' + roleBadge(student.role) + '<div class="student-detail" style="margin-top:6px"><span class="chip">' + esc(student.cohort_label) + '</span></div></div><div><strong>' + taskCount + '</strong> 个任务 / ' + own.length + " 个当前提交" + (manage ? '<div style="margin-top:8px">' + manage + "</div>" : "") + "</div></article>";
    }).join("") : '<div class="empty">暂无新生账号。</div>';
  }

  function renderInvites() {
    el("inviteList").innerHTML = invites.length ? invites.map(function (invite) {
      return '<div class="invite-row"><div><strong>' + esc(invite.cohort_label) + '</strong><div class="muted small">创建于 ' + formatDate(invite.created_at) + (invite.disabled_at ? " · 停用于 " + formatDate(invite.disabled_at) : "") + '</div></div><div class="cluster"><span class="status ' + (invite.is_active ? "submitted" : "unsubmitted") + '">' + (invite.is_active ? "使用中" : "已停用") + '</span>' + (invite.is_active ? '<button class="text-button" type="button" data-disable-invite="' + esc(invite.id) + '">停用</button>' : "") + "</div></div>";
    }).join("") : '<div class="empty">尚未创建邀请码。</div>';
  }

  function renderDeletions() {
    var requested = profiles.filter(function (item) { return !!item.deletion_requested_at; });
    el("deletionList").innerHTML = requested.length ? requested.map(function (student) {
      return '<article class="portal-card admin-row"><div><div class="student-name">' + esc(student.full_name) + '</div><div class="student-detail">' + esc(student.email) + '</div></div><div>' + esc(student.student_id) + '<div class="student-detail">' + esc(student.major_class) + '</div></div><div>' + formatDate(student.deletion_requested_at) + '</div><span class="status attention">等待处理</span></article>';
    }).join("") : '<div class="empty">没有待处理的删除申请。</div>';
  }

  function openDetail(id) {
    var item = submissions.find(function (submission) { return submission.id === id; });
    if (!item) return;
    var student = profileFor(item.user_id); var task = assignmentFor(item.assignment_id);
    var files = attachments.filter(function (file) { return file.submission_id === id; });
    el("detailTitle").textContent = task ? task.title : item.assignment_id;
    el("detailBody").innerHTML = '<div class="notice"><strong>' + esc(student.full_name) + '</strong> · ' + esc(student.student_id) + " · " + esc(student.major_class) + " · QQ " + esc(student.qq) + '</div><div><strong>提交时间</strong><p class="muted">' + formatDate(item.created_at) + '</p></div><div><strong>作业说明</strong><p class="muted" style="white-space:pre-wrap">' + esc(item.description || "未填写说明") + '</p></div>' + renderLinkBlock(item.repository_url) + '<div><strong>附件（' + files.length + '）</strong><div class="file-list">' + (files.length ? files.map(function (file) { return '<a class="file-link" href="#" data-download-path="' + esc(file.storage_path) + '"><span>📎 ' + esc(file.original_name) + '</span><span>' + formatBytes(file.size_bytes) + "</span></a>"; }).join("") : '<span class="muted small">没有附件</span>') + "</div></div>";
    el("submissionDetailModal").classList.remove("hidden"); document.body.style.overflow = "hidden";
  }

  async function createInvite(event) {
    event.preventDefault(); var form = event.currentTarget; var message = el("inviteMessage");
    try {
      form.querySelector("button").disabled = true; message.className = "notice hidden";
      await AIClub.rpc("admin_create_invite", { p_cohort_label: form.cohortLabel.value.trim(), p_code: form.code.value });
      form.reset(); message.textContent = "新邀请码已启用。请通过安全渠道发送给本届新生；离开本页后无法找回明文。"; message.className = "notice success"; await loadData();
    } catch (err) { message.textContent = AIClub.friendlyError(err); message.className = "notice error"; }
    finally { form.querySelector("button").disabled = false; }
  }

  document.addEventListener("click", async function (event) {
    var tab = event.target.closest("[data-admin-panel]");
    if (tab) {
      document.querySelectorAll("[data-admin-panel]").forEach(function (item) { item.classList.toggle("active", item === tab); });
      document.querySelectorAll("[data-admin-content]").forEach(function (panel) { panel.classList.toggle("hidden", panel.id !== tab.dataset.adminPanel + "Panel"); });
    }
    var view = event.target.closest("[data-view-submission]"); if (view) openDetail(view.dataset.viewSubmission);
    if (event.target.closest("[data-close-detail]")) { el("submissionDetailModal").classList.add("hidden"); document.body.style.overflow = ""; }
    var download = event.target.closest("[data-download-path]");
    if (download) {
      event.preventDefault(); var popup = window.open("about:blank", "_blank");
      try { var url = await AIClub.signedUrl(download.dataset.downloadPath, 120); if (popup) { popup.opener = null; popup.location = url; } else location.href = url; }
      catch (err) { if (popup) popup.close(); showNotice(AIClub.friendlyError(err), "error"); }
    }
    var setRole = event.target.closest("[data-set-role]");
    if (setRole) {
      var separator = setRole.dataset.setRole.lastIndexOf("|");
      var targetId = setRole.dataset.setRole.slice(0, separator);
      var newRole = setRole.dataset.setRole.slice(separator + 1);
      var member = profileFor(targetId);
      var actionText = newRole === "admin" ? "设为管理员" : "移除管理员";
      if (member && confirm("确认把「" + member.full_name + "」" + actionText + "吗？")) {
        try {
          await AIClub.rpc("admin_set_role", { p_target_user_id: targetId, p_new_role: newRole });
          showNotice("已" + actionText + "：" + member.full_name, "success");
          await loadData();
        } catch (err) { showNotice(AIClub.friendlyError(err), "error"); }
      }
    }
    var disable = event.target.closest("[data-disable-invite]");
    if (disable && confirm("确认停用这个邀请码吗？已注册账号不受影响。")) {
      try { await AIClub.rpc("admin_set_invite_active", { p_invite_id: disable.dataset.disableInvite, p_active: false }); await loadData(); }
      catch (err) { showNotice(AIClub.friendlyError(err), "error"); }
    }
  });

  ["filterCohort", "filterCourse", "filterAssignment"].forEach(function (id) { el(id).addEventListener("change", renderSubmissions); });
  el("filterStudent").addEventListener("input", renderSubmissions);
  el("filterCourse").addEventListener("change", function () {
    var course = this.value;
    Array.from(el("filterAssignment").options).forEach(function (option) { option.hidden = !!course && !!option.dataset.course && option.dataset.course !== course; });
    if (el("filterAssignment").selectedOptions[0].hidden) el("filterAssignment").value = "";
  });
  el("resetFilters").addEventListener("click", function () { el("filterCohort").value = ""; el("filterCourse").value = ""; el("filterAssignment").value = ""; el("filterStudent").value = ""; renderSubmissions(); });
  el("inviteForm").addEventListener("submit", createInvite);
  el("adminSignOut").addEventListener("click", async function () { await AIClub.signOut(); location.href = "account.html"; });

  async function init() {
    try {
      if (!AIClub.configured()) throw new Error("作业系统尚未配置 Supabase，请先完成 README 中的初始化步骤。");
      var active = await AIClub.session(false);
      if (!active) { location.href = "account.html"; return; }
      adminProfile = await AIClub.profile();
      if (adminProfile.role !== "admin" && adminProfile.role !== "owner") throw new Error("当前账号没有管理员权限");
      await loadData();
      el("adminLoading").classList.add("hidden"); el("adminApp").classList.remove("hidden");
    } catch (err) { el("adminLoading").classList.add("hidden"); showNotice(AIClub.friendlyError(err), "error"); }
  }
  init();
})();
