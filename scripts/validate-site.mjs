import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const errors = [];
const notes = [];

function check(condition, message) {
  if (!condition) errors.push(message);
}

const jsDir = path.join(root, "js");
for (const name of fs.readdirSync(jsDir).filter((item) => item.endsWith(".js"))) {
  try { execFileSync(process.execPath, ["--check", path.join(jsDir, name)], { stdio: "pipe" }); }
  catch (error) { errors.push(`JavaScript 语法错误：${name}\n${error.stderr?.toString() || error.message}`); }
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, "content", "course-catalog.json"), "utf8"));
check(catalog.courses?.length === 2, "课程目录应包含 C 语言和 STM32 两门课");
const stableIds = [];
let chapterCount = 0;
for (const course of catalog.courses || []) {
  check(course.id && course.title && Array.isArray(course.chapters), `课程配置不完整：${course.id || "未知课程"}`);
  stableIds.push(course.id);
  for (const chapter of course.chapters || []) {
    chapterCount += 1;
    stableIds.push(chapter.id, chapter.assignment?.id);
    check(chapter.assignment?.title, `章节缺少作业配置：${chapter.id}`);
    if (!fs.existsSync(path.join(root, chapter.content))) notes.push(`正文待补充：${chapter.content}`);
  }
}
check(stableIds.every(Boolean), "课程、章节或作业存在空 ID");
check(new Set(stableIds).size === stableIds.length, "课程、章节和作业 ID 必须全局唯一");

const htmlFiles = fs.readdirSync(root).filter((name) => name.endsWith(".html"));
for (const name of htmlFiles) {
  const source = fs.readFileSync(path.join(root, name), "utf8");
  const refs = [...source.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  for (const ref of refs) {
    if (/^(?:https?:|mailto:|#)/.test(ref)) continue;
    const local = ref.split(/[?#]/)[0];
    if (local) check(fs.existsSync(path.join(root, local)), `${name} 引用了不存在的文件：${local}`);
  }
}

const contentCode = fs.readFileSync(path.join(jsDir, "course-content.js"), "utf8");
const context = { window: {} };
vm.runInNewContext(contentCode, context);
const rendered = context.window.CourseContent.renderMarkdown("# 标题\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1))");
check(!rendered.includes("<script>"), "Markdown 渲染器没有转义原始 HTML");
check(!rendered.includes('href="javascript:'), "Markdown 渲染器允许危险链接");

const apiCode = fs.readFileSync(path.join(jsDir, "supabase-api.js"), "utf8");
const requests = [];
const memory = new Map();
const apiContext = {
  URL,
  URLSearchParams,
  history: { replaceState() {} },
  localStorage: {
    getItem(key) { return memory.get(key) ?? null; },
    setItem(key, value) { memory.set(key, value); },
    removeItem(key) { memory.delete(key); }
  },
  fetch: async (url, options) => {
    requests.push({ url: String(url), options });
    return { ok: true, status: 200, text: async () => "{}" };
  },
  window: {
    location: { href: "https://example.test/ai-club-website/account.html" },
    AI_CLUB_CONFIG: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "sb_publishable_test",
      STORAGE_BUCKET: "homework-private"
    }
  }
};
vm.runInNewContext(apiCode, apiContext);
await apiContext.window.AIClub.signUp({
  email: "student@example.test", password: "password123", fullName: "测试新生",
  studentId: "20260001", majorClass: "自动化 2601", qq: "12345678", inviteCode: "secret-code"
});
const signupRequest = requests[0];
const signupBody = JSON.parse(signupRequest.options.body);
check(signupRequest.url.includes("/auth/v1/signup?redirect_to="), "注册请求缺少邮箱验证回跳地址");
check(signupBody.data?.invite_code === "secret-code", "注册请求没有把邀请码交给服务端触发器校验");
check(!("options" in signupBody), "注册请求错误地使用了 SDK 专用 options 字段");

const schema = fs.readFileSync(path.join(root, "supabase", "schema.sql"), "utf8");
for (const required of [
  "alter table public.profiles enable row level security",
  "submissions_select_own_or_admin",
  "attachments_select_own_or_admin",
  "homework_object_insert_own_open_submission",
  "homework_object_select_authorized",
  "validate_invite_code",
  "complete_submission",
  "is_complete boolean"
]) check(schema.includes(required), `数据库脚本缺少安全规则：${required}`);
check(!/\b(service_role|SUPABASE_SERVICE_ROLE_KEY)\s*[:=]\s*["'][^"']+/i.test(schema), "数据库脚本疑似包含高权限密钥");

const allText = [
  ...htmlFiles.map((name) => fs.readFileSync(path.join(root, name), "utf8")),
  ...fs.readdirSync(jsDir).map((name) => fs.readFileSync(path.join(jsDir, name), "utf8"))
].join("\n");
check(!/ghp_[A-Za-z0-9]{20,}/.test(allText), "前端文件中疑似包含 GitHub Token");
check(!/负责人反馈|查看反馈/.test(allText), "页面中仍存在负责人反馈功能文案");

if (errors.length) {
  console.error(`验证失败（${errors.length} 项）：`);
  errors.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}

console.log(`验证通过：${htmlFiles.length} 个页面、${catalog.courses.length} 门课程、${chapterCount} 个章节、${fs.readdirSync(jsDir).length} 个脚本。`);
if (notes.length) {
  console.log(`允许的待办（${notes.length} 项）：`);
  notes.forEach((item) => console.log(`- ${item}`));
}
