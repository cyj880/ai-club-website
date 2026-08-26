/*
 * Supabase Database Webhook -> 飞书多维表格同步
 *
 * 触发来源：public.profiles 的 INSERT、public.submissions 的 INSERT/UPDATE。
 * 只同步新生姓名和任务完成状态，不同步学号、QQ、邮箱、作业内容或附件。
 *
 * 需要在 Supabase Edge Function Secrets 中设置：
 * FEISHU_APP_ID
 * FEISHU_APP_SECRET
 * FEISHU_APP_TOKEN
 * FEISHU_TABLE_ID
 * FEISHU_SYNC_WEBHOOK_SECRET
 *
 * SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 由 Supabase 自动提供。
 */

const FEISHU_API = "https://open.feishu.cn/open-apis";
const NAME_FIELDS = ["名字", "姓名"];
const TASK_FIELDS: Record<string, string> = {
  "c-2026-01-hello-world": "任务一",
  "c-2026-02-weighted-grade": "任务二",
  "c-2026-03-leap-year": "任务三",
  "c-2026-04-three-number-sort": "任务四",
  "c-2026-05-six-number-minimum": "任务五",
  "c-2026-06-student-ranking": "任务六",
  "c-2026-07-pointer-swap": "任务七",
  "c-2026-08-book-struct": "任务八",
};

type AnyRecord = Record<string, any>;
type Field = { field_name: string; type: number; property?: AnyRecord };

class FeishuApiError extends Error {
  status: number;
  code?: number;

  constructor(message: string, status: number, code?: number) {
    super(message);
    this.name = "FeishuApiError";
    this.status = status;
    this.code = code;
  }
}

const env = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`缺少后端环境变量 ${name}`);
  return value;
};

const SUPABASE_URL = env("SUPABASE_URL");
// 新版 Supabase 项目使用 sb_secret_...；旧项目继续兼容自动注入的
// service_role JWT。新式 Secret key 只作为 apikey 发送，不能当 JWT 使用。
const SERVICE_KEY = Deno.env.get("AI_CLUB_SUPABASE_SECRET_KEY")?.trim()
  || env("SUPABASE_SERVICE_ROLE_KEY");
const APP_ID = env("FEISHU_APP_ID");
const APP_SECRET = env("FEISHU_APP_SECRET");
const APP_TOKEN = env("FEISHU_APP_TOKEN");
const TABLE_ID = env("FEISHU_TABLE_ID");
const WEBHOOK_SECRET = env("FEISHU_SYNC_WEBHOOK_SECRET");

let cachedTenantToken = "";
let cachedTenantTokenExpiresAt = 0;
let cachedFields: Field[] | null = null;

async function readJson(response: Response): Promise<AnyRecord> {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch (_) { return { raw: text }; }
}

async function getTenantToken(): Promise<string> {
  if (cachedTenantToken && cachedTenantTokenExpiresAt > Date.now() + 60_000) {
    return cachedTenantToken;
  }
  const response = await fetch(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const data = await readJson(response);
  if (!response.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`飞书鉴权失败（${data.msg || response.status}）`);
  }
  cachedTenantToken = data.tenant_access_token;
  cachedTenantTokenExpiresAt = Date.now() + Number(data.expire || 7_200) * 1_000;
  return cachedTenantToken;
}

async function feishuRequest(path: string, init: RequestInit = {}): Promise<AnyRecord> {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${await getTenantToken()}`);
  headers.set("Content-Type", "application/json");
  const response = await fetch(`${FEISHU_API}${path}`, { ...init, headers });
  const data = await readJson(response);
  if (!response.ok || (typeof data.code === "number" && data.code !== 0)) {
    throw new FeishuApiError(
      `飞书 API 失败（${data.msg || response.status}）`,
      response.status,
      typeof data.code === "number" ? data.code : undefined,
    );
  }
  return data;
}

async function supabaseRequest(path: string, init: RequestInit = {}): Promise<any> {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", SERVICE_KEY);
  // 新版 sb_secret_... 是 API key，不是 JWT：只放在 apikey 头中。
  // 如果把它伪装成 Authorization Bearer，PostgREST 会按 anon 角色处理，
  // 从而出现 permission denied for table profiles。旧 service_role JWT
  // 则同时需要 Authorization 头。
  if (!SERVICE_KEY.startsWith("sb_")) {
    headers.set("Authorization", `Bearer ${SERVICE_KEY}`);
  }
  headers.set("Content-Type", "application/json");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(`Supabase 数据库请求失败（${response.status}：${data.message || data.error || data.msg || "未知错误"}）`);
  }
  return data;
}

async function supabaseRpc(name: string, body: AnyRecord): Promise<any> {
  return supabaseRequest(`rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function tableFields(): Promise<Field[]> {
  if (cachedFields) return cachedFields;
  const data = await feishuRequest(
    `/bitable/v1/apps/${encodeURIComponent(APP_TOKEN)}/tables/${encodeURIComponent(TABLE_ID)}/fields?page_size=100`,
  );
  cachedFields = (data.data?.items || []) as Field[];
  if (!cachedFields.length) throw new Error("飞书表格没有可用字段");
  return cachedFields;
}

function fieldByName(fields: Field[], name: string): Field | undefined {
  return fields.find((field) => field.field_name === name);
}

function submittedValue(field: Field): any {
  // 飞书字段类型：1 文本、2 数字、3 单选、4 多选、5 日期时间、7 复选框。
  // 推荐把任务一至任务八设为“复选框”或“文本”。单选字段需预先建立“已提交”选项。
  switch (field.type) {
    case 1: return "已提交";
    case 2: return 1;
    case 3: {
      const options = field.property?.options || [];
      const option = options.find((item: AnyRecord) => item.name === "已提交")
        || options.find((item: AnyRecord) => ["完成", "已完成", "是"].includes(item.name));
      if (!option) throw new Error(`飞书字段“${field.field_name}”是单选，请先添加“已提交”选项，或改为文本/复选框`);
      return option.name;
    }
    case 4: return ["已提交"];
    case 5: return Date.now();
    case 7: return true;
    default: throw new Error(`飞书字段“${field.field_name}”类型不支持，请改为文本或复选框`);
  }
}

function unsubmittedValue(field: Field): any {
  // 回填时必须同时清空未提交任务，才能纠正负责人误手动勾选的状态。
  switch (field.type) {
    case 1: return "";
    case 2: return null;
    case 3: return null;
    case 4: return [];
    case 5: return null;
    case 7: return false;
    default: throw new Error(`飞书字段“${field.field_name}”类型不支持，请改为文本或复选框`);
  }
}

function nameField(fields: Field[]): string {
  const match = NAME_FIELDS.find((name) => fieldByName(fields, name));
  if (!match) throw new Error("飞书表格缺少“名字”字段");
  return match;
}

async function createFeishuRecord(profile: AnyRecord, fields: Field[]): Promise<string> {
  const name = nameField(fields);
  const body: AnyRecord = { [name]: String(profile.full_name || "") };
  const data = await feishuRequest(
    `/bitable/v1/apps/${encodeURIComponent(APP_TOKEN)}/tables/${encodeURIComponent(TABLE_ID)}/records`,
    { method: "POST", body: JSON.stringify({ fields: body }) },
  );
  const recordId = data.data?.record?.record_id;
  if (!recordId) throw new Error("飞书没有返回新记录 ID");
  await supabaseRpc("feishu_set_record_id", {
    p_user_id: profile.id,
    p_record_id: recordId,
    p_sync_secret: WEBHOOK_SECRET,
  });
  return recordId;
}

async function ensureRecord(profile: AnyRecord, fields: Field[]): Promise<string> {
  if (profile.feishu_record_id) return profile.feishu_record_id;
  return createFeishuRecord(profile, fields);
}

async function updateFeishuRecord(recordId: string, values: AnyRecord): Promise<void> {
  await feishuRequest(
    `/bitable/v1/apps/${encodeURIComponent(APP_TOKEN)}/tables/${encodeURIComponent(TABLE_ID)}/records/${encodeURIComponent(recordId)}`,
    { method: "PUT", body: JSON.stringify({ fields: values }) },
  );
}

function isMissingFeishuRecord(error: unknown): boolean {
  if (!(error instanceof FeishuApiError)) return false;
  // 删除飞书行后，接口可能返回 HTTP 404，也可能返回 HTTP 400 + 业务错误码。
  // 不把权限、字段配置等其他错误误判成“行被删除”。
  if (error.status === 404) return true;
  if (error.code === 1254043 || error.code === 1254044) return true;
  return /record(?:\s*id)?(?:\s*not\s*found|\s*does\s*not\s*exist)|记录.*(不存在|找不到)/i.test(error.message);
}

function recordValues(profile: AnyRecord, fields: Field[], submittedIds: string[]): AnyRecord {
  const name = nameField(fields);
  const values: AnyRecord = { [name]: String(profile.full_name || "") };
  const submitted = new Set(submittedIds);

  // 每次写入都完整覆盖任务列：已提交写入“已提交/勾选”，未提交写入空值/未勾选。
  // 这样飞书表格不会保留负责人之前手动改出的错误状态。
  for (const assignmentId of Object.keys(TASK_FIELDS)) {
    const fieldName = TASK_FIELDS[assignmentId];
    const field = fieldByName(fields, fieldName);
    if (!field) {
      if (submitted.has(assignmentId)) throw new Error(`飞书表格缺少“${fieldName}”字段`);
      continue;
    }
    values[fieldName] = submitted.has(assignmentId) ? submittedValue(field) : unsubmittedValue(field);
  }
  return values;
}

async function completedAssignmentIds(userId: string): Promise<string[]> {
  // 继续通过已有的受密钥保护 RPC 获取数据，避免新版 sb_secret 项目直接读取
  // submissions 时因 PostgREST 角色映射不同再次出现 403。
  const result = await supabaseRpc("feishu_backfill", {
    p_sync_secret: WEBHOOK_SECRET,
  }) as AnyRecord;
  const rows = Array.isArray(result?.submissions) ? result.submissions : [];
  return rows
    .filter((row: AnyRecord) => row.user_id === userId)
    .map((row: AnyRecord) => String(row.assignment_id || ""))
    .filter((assignmentId: string) => Boolean(TASK_FIELDS[assignmentId]));
}

async function syncFeishuRecord(profile: AnyRecord, fields: Field[], submittedIds: string[] = []): Promise<void> {
  let recordId = await ensureRecord(profile, fields);
  const values = recordValues(profile, fields, submittedIds);
  try {
    // 始终回写姓名：除了修正改名，也能主动探测“飞书行已被手动删除”。
    await updateFeishuRecord(recordId, values);
  } catch (error) {
    if (!isMissingFeishuRecord(error)) throw error;
    // profiles 中保存的旧 record_id 已经失效。重新创建一行并覆盖数据库中的旧 ID，
    // 再写入本次回填到的任务状态，这样误删后下一次提交/回填即可自动恢复。
    console.warn(`飞书记录 ${recordId} 不存在，正在为 ${profile.full_name || profile.id} 重建记录`);
    recordId = await createFeishuRecord(profile, fields);
    await updateFeishuRecord(recordId, values);
  }
}

async function syncProfile(profile: AnyRecord, submittedIds: string[] = []): Promise<void> {
  if (!profile || profile.role !== "student") return;
  const fields = await tableFields();
  await syncFeishuRecord(profile, fields, submittedIds);
}

async function profileById(id: string): Promise<AnyRecord | null> {
  return await supabaseRpc("feishu_get_profile", {
    p_user_id: id,
    p_sync_secret: WEBHOOK_SECRET,
  }) as AnyRecord | null;
}

async function backfill(): Promise<{ students: number; submissions: number }> {
  const result = await supabaseRpc("feishu_backfill", {
    p_sync_secret: WEBHOOK_SECRET,
  }) as AnyRecord;
  const profiles = (result?.profiles || []) as AnyRecord[];
  const submissions = (result?.submissions || []) as AnyRecord[];
  const grouped = new Map<string, string[]>();
  for (const submission of submissions) {
    const ids = grouped.get(submission.user_id) || [];
    if (!ids.includes(submission.assignment_id)) ids.push(submission.assignment_id);
    grouped.set(submission.user_id, ids);
  }
  const fields = await tableFields();
  for (const profile of profiles) {
    await syncFeishuRecord(profile, fields, grouped.get(profile.id) || []);
  }
  return { students: profiles.length, submissions: submissions.length };
}

function json(status: number, body: AnyRecord): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "method not allowed" });
  if (request.headers.get("x-feishu-sync-secret") !== WEBHOOK_SECRET) {
    return json(401, { error: "unauthorized" });
  }
  try {
    const payload = await request.json() as AnyRecord;
    if (payload.action === "backfill" || payload.type === "BACKFILL") {
      return json(200, { ok: true, action: "backfill", ...(await backfill()) });
    }
    const table = payload.table || payload.record?.table;
    const record = payload.record || {};
    if (table === "profiles" && (payload.type === "INSERT" || !payload.type)) {
      // 重新从数据库读取，拿到可能已经写入的 feishu_record_id；这样 webhook
      // 重试时不会因为第一次请求已创建记录而在飞书重复新增一行。
      const profile = record.id ? await profileById(record.id) : record;
      await syncProfile(profile || record);
    } else if (table === "submissions" && record.is_complete === true) {
      const profile = await profileById(record.user_id);
      if (profile) await syncProfile(profile, await completedAssignmentIds(record.user_id));
    }
    return json(200, { ok: true });
  } catch (error) {
    console.error(error);
    return json(500, { error: error instanceof Error ? error.message : "sync failed" });
  }
});
