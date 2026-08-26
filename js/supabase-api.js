(function () {
  "use strict";

  var config = window.AI_CLUB_CONFIG || {};
  var SESSION_KEY = "ai-club-supabase-session";

  function configured() {
    return /^https:\/\/.+\.supabase\.co$/.test(config.SUPABASE_URL || "") &&
      !!config.SUPABASE_ANON_KEY && !config.SUPABASE_ANON_KEY.startsWith("YOUR_");
  }

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
    catch (_) { return null; }
  }

  function saveSession(session) {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  }

  function normalizeSession(data) {
    if (!data || !data.access_token) return data;
    data.expires_at = Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600);
    saveSession(data);
    return data;
  }

  function errorMessage(data, fallback) {
    if (!data) return fallback;
    return data.msg || data.message || data.error_description || data.error || data.hint || fallback;
  }

  async function request(url, options) {
    options = options || {};
    var headers = Object.assign({ apikey: config.SUPABASE_ANON_KEY }, options.headers || {});
    var response;
    try {
      response = await fetch(url, Object.assign({}, options, { headers: headers }));
    } catch (_) {
      throw new Error("无法连接服务，请检查网络后重试");
    }
    var text = await response.text();
    var data = null;
    if (text) {
      try { data = JSON.parse(text); }
      catch (_) { data = text; }
    }
    if (!response.ok) {
      var err = new Error(errorMessage(data, "请求失败（" + response.status + "）"));
      err.status = response.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function refreshSession() {
    var session = readSession();
    if (!session || !session.refresh_token) return null;
    try {
      var data = await request(config.SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      });
      return normalizeSession(data);
    } catch (err) {
      saveSession(null);
      throw err;
    }
  }

  async function session(required) {
    var current = readSession();
    if (!current) {
      if (required) throw new Error("请先登录");
      return null;
    }
    if (!current.expires_at || current.expires_at < Math.floor(Date.now() / 1000) + 60) {
      current = await refreshSession();
    }
    return current;
  }

  async function authHeaders(required) {
    var current = await session(required);
    return current ? { Authorization: "Bearer " + current.access_token } : {};
  }

  async function signUp(values) {
    var redirect = new URL("account.html", window.location.href).href;
    var data = await request(config.SUPABASE_URL + "/auth/v1/signup?redirect_to=" + encodeURIComponent(redirect), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: values.email,
        password: values.password,
        data: {
          full_name: values.fullName,
          student_id: values.studentId,
          major_class: values.majorClass,
          qq: values.qq,
          invite_code: values.inviteCode
        }
      })
    });
    if (data && data.access_token) normalizeSession(data);
    return data;
  }

  async function signIn(email, password) {
    var data = await request(config.SUPABASE_URL + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password })
    });
    return normalizeSession(data);
  }

  async function recover(email) {
    var redirect = new URL("account.html?action=reset", window.location.href).href;
    return request(config.SUPABASE_URL + "/auth/v1/recover?redirect_to=" + encodeURIComponent(redirect), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, gotrue_meta_security: {} })
    });
  }

  async function updatePassword(password) {
    return request(config.SUPABASE_URL + "/auth/v1/user", {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, await authHeaders(true)),
      body: JSON.stringify({ password: password })
    });
  }

  async function signOut() {
    var current = readSession();
    if (current) {
      try {
        await request(config.SUPABASE_URL + "/auth/v1/logout", {
          method: "POST",
          headers: { Authorization: "Bearer " + current.access_token }
        });
      } catch (_) { /* 本地会话仍应清除 */ }
    }
    saveSession(null);
  }

  function acceptAuthRedirect() {
    var hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (!hash.get("access_token")) return null;
    var data = {
      access_token: hash.get("access_token"),
      refresh_token: hash.get("refresh_token"),
      expires_in: Number(hash.get("expires_in") || 3600),
      token_type: hash.get("token_type") || "bearer",
      type: hash.get("type") || ""
    };
    normalizeSession(data);
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return data;
  }

  async function db(path, options) {
    options = options || {};
    var headers = Object.assign({ "Content-Type": "application/json" }, await authHeaders(options.required !== false), options.headers || {});
    return request(config.SUPABASE_URL + "/rest/v1/" + path, Object.assign({}, options, { headers: headers }));
  }

  async function rpc(name, body) {
    return db("rpc/" + name, { method: "POST", body: JSON.stringify(body || {}) });
  }

  async function rpcPublic(name, body) {
    return db("rpc/" + name, { method: "POST", body: JSON.stringify(body || {}), required: false });
  }

  async function profile() {
    var current = await session(true);
    if (!current.user || !current.user.id) {
      current.user = await request(config.SUPABASE_URL + "/auth/v1/user", {
        method: "GET",
        headers: { Authorization: "Bearer " + current.access_token }
      });
      saveSession(current);
    }
    var rows = await db("profiles?id=eq." + encodeURIComponent(current.user.id) + "&select=*", { method: "GET" });
    if (!rows || !rows[0]) throw new Error("未找到成员资料，请联系负责人");
    return rows[0];
  }

  function encodeObjectPath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  async function upload(path, file) {
    return request(config.SUPABASE_URL + "/storage/v1/object/" + encodeURIComponent(config.STORAGE_BUCKET) + "/" + encodeObjectPath(path), {
      method: "POST",
      headers: Object.assign({
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "false"
      }, await authHeaders(true)),
      body: file
    });
  }

  async function removeFiles(paths) {
    if (!paths.length) return;
    return request(config.SUPABASE_URL + "/storage/v1/object/" + encodeURIComponent(config.STORAGE_BUCKET), {
      method: "DELETE",
      headers: Object.assign({ "Content-Type": "application/json" }, await authHeaders(true)),
      body: JSON.stringify({ prefixes: paths })
    });
  }

  async function signedUrl(path, expiresIn) {
    var data = await request(config.SUPABASE_URL + "/storage/v1/object/sign/" + encodeURIComponent(config.STORAGE_BUCKET) + "/" + encodeObjectPath(path), {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, await authHeaders(true)),
      body: JSON.stringify({ expiresIn: expiresIn || 120 })
    });
    var signed = data.signedURL || data.signedUrl;
    if (!signed) throw new Error("无法生成下载地址");
    return /^https?:/.test(signed) ? signed : config.SUPABASE_URL + "/storage/v1" + signed;
  }

  function friendlyError(err) {
    var message = (err && err.message) || "操作失败，请稍后重试";
    var known = [
      [/Invalid login credentials/i, "邮箱或密码错误"],
      [/Email not confirmed/i, "此账号仍处于邮箱未确认状态，请联系负责人处理"],
      [/User already registered/i, "该邮箱已经注册"],
      [/Password should be at least/i, "密码长度至少为 8 位"],
      [/invalid invite code/i, "邀请码错误或已停用"],
      [/duplicate key.*student_id|profiles_student_id_key/i, "该学号已经注册"],
      [/rate limit/i, "操作过于频繁，请稍后再试"],
      [/fetch|network|Failed to fetch/i, "网络连接失败，请检查网络后重试"]
    ];
    known.some(function (item) {
      if (item[0].test(message)) { message = item[1]; return true; }
      return false;
    });
    return message;
  }

  window.AIClub = {
    config: config,
    configured: configured,
    session: session,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    recover: recover,
    updatePassword: updatePassword,
    acceptAuthRedirect: acceptAuthRedirect,
    db: db,
    rpc: rpc,
    rpcPublic: rpcPublic,
    profile: profile,
    upload: upload,
    removeFiles: removeFiles,
    signedUrl: signedUrl,
    friendlyError: friendlyError
  };
})();
