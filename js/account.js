(function () {
  "use strict";
  var profile;
  var catalog;
  var allAssignments = [];
  var submissions = [];
  var attachments = [];
  var selectedAssignment = null;
  var submissionBusy = false;
  var MAX_FILES = 5;
  var MAX_TOTAL = 20 * 1024 * 1024;
  var allowedExtensions = ["zip", "pdf", "png", "jpg", "jpeg"];

  function el(id) { return document.getElementById(id); }
  function esc(value) { return CourseContent.escapeHtml(value == null ? "" : value); }
  function formatDate(value) { return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—"; }
  function formatBytes(bytes) { return bytes < 1024 * 1024 ? Math.ceil(bytes / 1024) + " KB" : (bytes / 1024 / 1024).toFixed(1) + " MB"; }

  function showMessage(target, message, type) {
    target.textContent = message;
    target.className = "notice " + (type || "");
  }
  function hideMessage(target) { target.className = "notice hidden"; target.textContent = ""; }
  function setBusy(form, busy) {
    Array.prototype.forEach.call(form.querySelectorAll("button,input,textarea,select"), function (item) { item.disabled = busy; });
  }

  function showAuthPanel(name) {
    ["loginForm", "registerForm", "recoverForm", "newPasswordForm"].forEach(function (id) { el(id).classList.toggle("hidden", id !== name + "Form"); });
    el("authTabs").classList.toggle("hidden", name === "recover" || name === "newPassword");
    document.querySelectorAll("[data-auth-tab]").forEach(function (button) { button.classList.toggle("active", button.dataset.authTab === name); });
  }

  function showAuthReady(name) {
    el("authCheckingView").classList.add("hidden");
    el("dashboardView").classList.add("hidden");
    el("authView").classList.remove("hidden");
    showAuthPanel(name || "login");
  }

  function validateFiles(fileList) {
    var files = Array.from(fileList || []);
    if (!files.length) throw new Error("请至少选择一个附件");
    if (files.length > MAX_FILES) throw new Error("每次最多上传 5 个文件");
    var total = 0;
    files.forEach(function (file) {
      var extension = (file.name.split(".").pop() || "").toLowerCase();
      if (allowedExtensions.indexOf(extension) < 0) throw new Error("不支持的文件类型：" + file.name);
      total += file.size;
    });
    if (total > MAX_TOTAL) throw new Error("附件总大小不能超过 20MB");
    return { files: files, total: total };
  }

  function normalizeFile(file) {
    var extension = (file.name.split(".").pop() || "").toLowerCase();
    var types = { zip: "application/zip", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
    return new File([file], file.name, { type: types[extension], lastModified: file.lastModified });
  }

  function randomId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    return Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  async function loadDashboard() {
    profile = await AIClub.profile();
    catalog = await CourseContent.loadCatalog();
    allAssignments = CourseContent.assignments(catalog);
    var results = await Promise.all([
      AIClub.db("submissions?is_complete=eq.true&select=*&order=created_at.desc", { method: "GET" }),
      AIClub.db("attachments?select=*&order=created_at.asc", { method: "GET" })
    ]);
    submissions = results[0] || [];
    attachments = results[1] || [];
    try {
      await removeOlderSubmissions();
    } catch (_) {
      // 清理接口暂时不可用时仍只在页面显示最新提交；下次进入时会重试清理。
      var latest = latestOnly(submissions);
      var keepIds = new Set(latest.map(function (item) { return item.id; }));
      submissions = latest;
      attachments = attachments.filter(function (file) { return keepIds.has(file.submission_id); });
    }
    // 课程目录中已删除的旧任务不再出现在当前任务和提交记录中；
    // 数据库历史记录仍保留，避免更换任务时误删学生文件。
    var activeAssignmentIds = new Set(allAssignments.map(function (item) { return item.id; }));
    submissions = submissions.filter(function (item) { return activeAssignmentIds.has(item.assignment_id); });
    var activeSubmissionIds = new Set(submissions.map(function (item) { return item.id; }));
    attachments = attachments.filter(function (file) { return activeSubmissionIds.has(file.submission_id); });
    el("authCheckingView").classList.add("hidden");
    el("authView").classList.add("hidden");
    el("dashboardView").classList.remove("hidden");
    el("welcomeTitle").textContent = profile.full_name + "，继续学习吧";
    el("profileSummary").textContent = profile.cohort_label + " · " + profile.major_class;
    if (profile.role === "admin" || profile.role === "owner") el("adminLink").classList.remove("hidden");
    renderDashboard();
    var requested = new URLSearchParams(location.search).get("assignment");
    if (requested) {
      var assignment = allAssignments.find(function (item) { return item.id === requested; });
      if (assignment) openSubmission(assignment);
    }
  }

  function latestFor(assignmentId) {
    return submissions.filter(function (item) { return item.assignment_id === assignmentId; }).sort(function (a, b) { return b.version - a.version; })[0] || null;
  }

  function latestOnly(items) {
    var seen = new Set();
    return items.slice().sort(function (a, b) { return b.version - a.version; }).filter(function (item) {
      var key = (item.user_id || "") + ":" + item.assignment_id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function removeOlderSubmissions() {
    if (profile.role !== "student") return;
    var latest = latestOnly(submissions);
    var keepIds = new Set(latest.map(function (item) { return item.id; }));
    var older = submissions.filter(function (item) { return !keepIds.has(item.id); });
    if (older.length) {
      var olderIds = new Set(older.map(function (item) { return item.id; }));
      var olderPaths = attachments.filter(function (file) { return olderIds.has(file.submission_id); }).map(function (file) { return file.storage_path; });
      await AIClub.removeFiles(olderPaths);
      await AIClub.rpc("prune_submission_history", { p_assignment_id: null });
    }
    submissions = latest;
    attachments = attachments.filter(function (file) { return keepIds.has(file.submission_id); });
  }

  function renderDashboard() {
    var submitted = allAssignments.filter(function (item) { return !!latestFor(item.id); }).length;
    el("studentStats").innerHTML = '<div class="portal-card stat"><strong>' + submitted + '</strong><span>已提交任务</span></div><div class="portal-card stat"><strong>' + submissions.length + '</strong><span>当前提交</span></div><div class="portal-card stat"><strong>' + allAssignments.length + '</strong><span>全部任务</span></div>';

    el("taskList").innerHTML = allAssignments.map(function (assignment) {
      var latest = latestFor(assignment.id);
      return '<article class="portal-card task-card"><div class="split"><div><span class="chip">' + esc(assignment.courseTitle) + '</span><h3>' + esc(assignment.title) + '</h3></div><span class="status ' + (latest ? "submitted" : "unsubmitted") + '">' + (latest ? "已提交" : "未提交") + '</span></div><p class="muted small">' + esc(assignment.description) + '</p>' + (latest ? '<div class="task-meta"><span>最后提交</span><span>·</span><span>' + formatDate(latest.created_at) + "</span></div>" : '<div class="task-meta"><span>尚未提交</span></div>') + '<div class="cluster" style="margin-top:14px"><button class="btn btn-primary" type="button" data-submit-assignment="' + esc(assignment.id) + '">' + (latest ? "重新提交" : "提交作业") + '</button><a class="text-button" href="learn.html?course=' + encodeURIComponent(assignment.courseId) + '&chapter=' + encodeURIComponent(assignment.chapterId) + '">查看章节</a></div></article>';
    }).join("");

    el("submissionList").innerHTML = submissions.length ? submissions.map(renderSubmission).join("") : '<div class="empty">还没有提交记录。</div>';
    var deletionText = profile.deletion_requested_at ? '<div class="notice warning">已于 ' + formatDate(profile.deletion_requested_at) + ' 提交删除申请。管理员确认身份后会处理。</div><button class="text-button" type="button" id="cancelDeletion">撤回删除申请</button>' : '<div class="notice">如需删除账号及全部个人资料，可以在这里提交申请。管理员需要在 Supabase 后台确认执行。</div><button class="btn btn-outline" type="button" id="requestDeletion">申请删除账号及资料</button>';
    el("profileDetails").innerHTML = '<div class="form-grid"><div class="field"><label>真实姓名</label><div>' + esc(profile.full_name) + '</div></div><div class="field"><label>学号</label><div>' + esc(profile.student_id) + '</div></div><div class="field"><label>专业班级</label><div>' + esc(profile.major_class) + '</div></div><div class="field"><label>QQ</label><div>' + esc(profile.qq) + '</div></div><div class="field"><label>届别</label><div>' + esc(profile.cohort_label) + '</div></div><div class="field"><label>账号角色</label><div>' + (profile.role === "owner" ? "群主" : profile.role === "admin" ? "管理员" : "新生") + '</div></div></div><div class="divider"></div>' + deletionText + '<p class="muted small">资料需要更正时，请通过招新 QQ 群 551018478 联系负责人。</p>';
  }

  function renderSubmission(item) {
    var assignment = allAssignments.find(function (a) { return a.id === item.assignment_id; });
    var files = attachments.filter(function (file) { return file.submission_id === item.id; });
    return '<article class="portal-card submission-card"><div class="split"><div><span class="chip">' + esc(assignment ? assignment.courseTitle : item.course_id) + '</span><h3>' + esc(assignment ? assignment.title : item.assignment_id) + '</h3></div><span class="status submitted">当前提交</span></div><p class="muted small">提交于 ' + formatDate(item.created_at) + '</p>' + (item.description ? '<p style="margin-top:10px;white-space:pre-wrap">' + esc(item.description) + "</p>" : "") + (item.repository_url ? '<p class="small"><a href="' + esc(item.repository_url) + '" target="_blank" rel="noopener noreferrer">查看链接（代码 / 演示视频）↗</a></p>' : "") + renderFiles(files) + "</article>";
  }

  function renderFiles(files) {
    if (!files.length) return "";
    return '<div class="file-list">' + files.map(function (file) { return '<a href="#" class="file-link" data-download-path="' + esc(file.storage_path) + '"><span>📎 ' + esc(file.original_name) + '</span><span>' + formatBytes(file.size_bytes) + "</span></a>"; }).join("") + "</div>";
  }

  function openSubmission(assignment) {
    // 上一次提交成功后表单曾处于 busy 状态；重新打开时必须恢复所有控件，
    // 否则“取消”按钮会被遗留为 disabled，看起来像点击无效。
    submissionBusy = false;
    setBusy(el("submissionForm"), false);
    selectedAssignment = assignment;
    el("submitModalTitle").textContent = assignment.title;
    el("submitModalDescription").textContent = assignment.description;
    el("submissionForm").reset();
    el("fileSummary").textContent = "";
    hideMessage(el("submissionMessage"));
    el("submitModal").classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
  function closeSubmission() {
    // 上传尚未完成时不关闭，避免留下未完成的数据库记录和孤立文件。
    if (submissionBusy) return;
    setBusy(el("submissionForm"), false);
    el("submitModal").classList.add("hidden");
    document.body.style.overflow = "";
    selectedAssignment = null;
  }

  async function submitHomework(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var message = el("submissionMessage");
    var created = null;
    var uploadedPaths = [];
    try {
      var validated = validateFiles(el("submissionFiles").files);
      var description = el("submissionDescription").value.trim();
      var repositoryUrl = el("repositoryUrl").value.trim() || null;
      submissionBusy = true;
      setBusy(form, true); showMessage(message, "正在创建提交记录…", "");
      created = await AIClub.rpc("create_submission", { p_course_id: selectedAssignment.courseId, p_assignment_id: selectedAssignment.id, p_description: description, p_repository_url: repositoryUrl });
      for (var i = 0; i < validated.files.length; i += 1) {
        var original = validated.files[i];
        var file = normalizeFile(original);
        // Storage 对象名只使用 ASCII；原始文件名（包括中文）单独写入附件记录。
        var extension = (original.name.split(".").pop() || "").toLowerCase();
        var path = profile.id + "/" + selectedAssignment.id + "/" + created.version + "/" + randomId() + "." + extension;
        showMessage(message, "正在上传第 " + (i + 1) + " / " + validated.files.length + " 个附件…", "");
        await AIClub.upload(path, file);
        uploadedPaths.push(path);
        await AIClub.rpc("register_attachment", { p_submission_id: created.id, p_storage_path: path, p_original_name: original.name, p_mime_type: file.type, p_size_bytes: file.size });
      }
      await AIClub.rpc("complete_submission", { p_submission_id: created.id });
      submissionBusy = false;
      showMessage(message, "提交成功，正在刷新记录…", "success");
      setTimeout(function () { closeSubmission(); loadDashboard().catch(showGlobalError); }, 650);
    } catch (err) {
      if (created) {
        try { await AIClub.removeFiles(uploadedPaths); } catch (_) { /* 数据库回滚仍继续 */ }
        try { await AIClub.rpc("discard_submission", { p_submission_id: created.id }); } catch (_) { /* 管理员可清理异常记录 */ }
      }
      submissionBusy = false;
      showMessage(message, AIClub.friendlyError(err), "error");
      setBusy(form, false);
    }
  }

  async function requestDeletion(requested) {
    var promptText = requested ? "确认申请删除账号、个人资料和全部作业吗？提交后需管理员核实处理。" : "确认撤回删除申请吗？";
    if (!window.confirm(promptText)) return;
    try {
      await AIClub.rpc("set_deletion_request", { p_requested: requested });
      await loadDashboard();
    } catch (err) { showGlobalError(err); }
  }

  function showGlobalError(err) {
    showMessage(el("globalNotice"), AIClub.friendlyError(err), "error");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.addEventListener("click", async function (event) {
    var target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    var tab = event.target.closest("[data-auth-tab]");
    if (tab) showAuthPanel(tab.dataset.authTab);
    if (event.target.closest("[data-back-login]")) showAuthPanel("login");
    if (target.closest("[data-close-modal]")) {
      event.preventDefault();
      closeSubmission();
      return;
    }
    if (target === el("submitModal") && !submissionBusy) {
      closeSubmission();
      return;
    }
    var submit = target.closest("[data-submit-assignment]");
    if (submit) {
      var assignment = allAssignments.find(function (item) { return item.id === submit.dataset.submitAssignment; });
      if (assignment) openSubmission(assignment);
    }
    var menu = event.target.closest("[data-panel]");
    if (menu) {
      document.querySelectorAll("#dashboardMenu [data-panel]").forEach(function (item) { item.classList.toggle("active", item === menu); });
      document.querySelectorAll("[data-dashboard-panel]").forEach(function (panel) { panel.classList.toggle("hidden", panel.id !== menu.dataset.panel + "Panel"); });
    }
    var download = event.target.closest("[data-download-path]");
    if (download) {
      event.preventDefault();
      var popup = window.open("about:blank", "_blank");
      try {
        var url = await AIClub.signedUrl(download.dataset.downloadPath, 120);
        if (popup) { popup.opener = null; popup.location = url; } else location.href = url;
      } catch (err) { if (popup) popup.close(); showGlobalError(err); }
    }
    if (event.target.id === "requestDeletion") requestDeletion(true);
    if (event.target.id === "cancelDeletion") requestDeletion(false);
  });

  // 直接绑定取消按钮作为委托事件的兜底，兼容部分移动浏览器的点击目标变化。
  document.querySelectorAll("#submitModal [data-close-modal]").forEach(function (button) {
    button.addEventListener("click", function (event) {
      event.preventDefault();
      closeSubmission();
    });
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !el("submitModal").classList.contains("hidden")) closeSubmission();
  });

  el("forgotButton").addEventListener("click", function () { el("recoverEmail").value = el("loginEmail").value; showAuthPanel("recover"); });
  el("submissionFiles").addEventListener("change", function () {
    try { var result = validateFiles(this.files); el("fileSummary").textContent = result.files.length + " 个文件，共 " + formatBytes(result.total); }
    catch (err) { el("fileSummary").textContent = err.message; this.value = ""; }
  });
  el("submissionForm").addEventListener("submit", submitHomework);

  el("loginForm").addEventListener("submit", async function (event) {
    event.preventDefault(); var form = event.currentTarget; var message = el("loginMessage");
    try { setBusy(form, true); hideMessage(message); await AIClub.signIn(form.email.value.trim(), form.password.value); await loadDashboard(); }
    catch (err) { showMessage(message, AIClub.friendlyError(err), "error"); }
    finally { setBusy(form, false); }
  });

  el("registerForm").addEventListener("submit", async function (event) {
    event.preventDefault(); var form = event.currentTarget; var message = el("registerMessage");
    try {
      if (form.password.value !== form.passwordConfirm.value) throw new Error("两次输入的密码不一致");
      setBusy(form, true); hideMessage(message);
      var inviteValid = await AIClub.rpcPublic("validate_invite_code", { p_code: form.inviteCode.value });
      if (!inviteValid) throw new Error("invalid invite code");
      var data = await AIClub.signUp({ email: form.email.value.trim(), password: form.password.value, fullName: form.fullName.value.trim(), studentId: form.studentId.value.trim(), majorClass: form.majorClass.value.trim(), qq: form.qq.value.trim(), inviteCode: form.inviteCode.value });
      if (data && data.access_token) await loadDashboard();
      else { form.reset(); showMessage(message, "账号已创建，请使用刚才的邮箱和密码登录；如果无法登录，请联系负责人。", "success"); }
    } catch (err) { showMessage(message, AIClub.friendlyError(err), "error"); }
    finally { setBusy(form, false); }
  });

  el("recoverForm").addEventListener("submit", async function (event) {
    event.preventDefault(); var form = event.currentTarget; var message = el("recoverMessage");
    try { setBusy(form, true); await AIClub.recover(form.email.value.trim()); showMessage(message, "如果该邮箱已注册，重置链接已发送，请检查收件箱和垃圾邮件。", "success"); }
    catch (err) { showMessage(message, AIClub.friendlyError(err), "error"); }
    finally { setBusy(form, false); }
  });

  el("newPasswordForm").addEventListener("submit", async function (event) {
    event.preventDefault(); var form = event.currentTarget; var message = el("newPasswordMessage");
    try {
      if (form.password.value !== form.passwordConfirm.value) throw new Error("两次输入的密码不一致");
      setBusy(form, true); await AIClub.updatePassword(form.password.value); showMessage(message, "密码已更新，正在进入个人中心…", "success"); setTimeout(loadDashboard, 500);
    } catch (err) { showMessage(message, AIClub.friendlyError(err), "error"); }
    finally { setBusy(form, false); }
  });

  el("signOutButton").addEventListener("click", async function () { await AIClub.signOut(); location.href = "account.html"; });

  async function init() {
    if (!AIClub.configured()) {
      showAuthReady("login");
      showMessage(el("globalNotice"), "作业系统尚未配置 Supabase。请先按照 README 完成后端初始化并填写公开项目配置；公开课程不受影响。", "warning");
      document.querySelectorAll("#authView form button[type=submit], #authView form input").forEach(function (item) { item.disabled = true; });
      return;
    }
    try {
      var redirect = AIClub.acceptAuthRedirect();
      if (redirect && redirect.type === "recovery") { showAuthReady("newPassword"); return; }
      if (new URLSearchParams(location.search).get("action") === "reset" && redirect) { showAuthReady("newPassword"); return; }
      var active = await AIClub.session(false);
      if (active) await loadDashboard();
      else showAuthReady("login");
    } catch (err) { showAuthReady("login"); showGlobalError(err); }
  }
  init();
})();
