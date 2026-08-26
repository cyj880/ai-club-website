# 人工智能协会网站

协会招新主页、新生公开课程和作业上传系统。前端继续部署在 GitHub Pages，账号、数据与私有作业文件由 Supabase 托管。

- 线上地址：https://cyj880.github.io/ai-club-website/
- 招新 QQ 群：551018478
- 前端：原生 HTML / CSS / JavaScript，无构建步骤
- 后端：Supabase Auth、Postgres、Row Level Security、Storage

系统只用于收集和查看作答情况，不提供标准答案、评分、批改或负责人反馈。

## 页面与目录

```text
index.html                   招新首页
learn.html                   C 语言 / STM32 公开学习中心
account.html                 注册、登录、作业上传与个人提交记录
admin.html                   负责人查看作答情况、新生名单与邀请码
privacy.html                 个人信息说明
content/course-catalog.json  课程、章节、作业稳定 ID
content/**/*.md              课程正文
supabase/schema.sql          数据表、RPC、RLS 和私有存储策略
supabase/feishu-sync.sql     已有项目接入飞书前需要执行的增量 SQL
supabase/functions/feishu-sync  Supabase Webhook 调用的飞书同步函数
js/supabase-config.js        允许公开的 Supabase 浏览器配置
```

## 接入飞书多维表格

飞书同步在后端完成，浏览器不会接触 App Secret。当前函数只写入学生的“名字”和 C 语言任务一至任务八的完成状态；STM32 暂不写入飞书，也不写入学号、QQ、邮箱、作业说明或附件。

用户提供的表格对应配置为：App ID `cli_aa0462c624381bfb`、App Token `N8KKbptymaofbHs1I3wc2MIln4e`、Table ID `tblm2o37DucTzleu`。App Secret 不要发到聊天或提交到 GitHub。

在飞书开放平台还要确认该应用已获得 **多维表格读写**（Bitable read/write）权限，并且已经被加入这份多维表格、拥有编辑权限；只有把 App ID 发给表格协作者还不够。

### 1. 执行增量 SQL

在 Supabase Dashboard → **SQL Editor** → **New query** 中粘贴并运行 `supabase/feishu-sync.sql`。它只给 `profiles` 增加一个内部映射字段 `feishu_record_id`，并创建受同步密钥保护的后端 RPC；不会在飞书表格显示学号。若之前已经运行过旧版增量 SQL，请重新运行本文件以补齐 RPC。

### 2. 整理飞书字段

第一列保留为文本字段 **名字**。`任务一` 至 `任务八` 建议全部改成 **复选框** 或 **文本**；如果保留单选，必须先给该列添加一个选项 **已提交**。日期字段可以使用，但附件字段不能写入状态，请将截图中带回形针的任务列改为文本或复选框。字段名必须逐字为：`任务一`、`任务二`、`任务三`、`任务四`、`任务五`、`任务六`、`任务七`、`任务八`。

### 3. 部署 Edge Function

在本地项目目录执行（需要先安装 Supabase CLI，并用自己的 Supabase 账号登录）：

```powershell
supabase login
supabase link --project-ref farfmzmspladckvuduey
supabase functions deploy feishu-sync --no-verify-jwt
```

`--no-verify-jwt` 是因为请求来自 Supabase Database Webhook；函数自己会校验下面的 webhook 密钥。若没有 CLI，可在 Supabase Dashboard → **Edge Functions** 按页面提供的 Deploy instructions 部署同名函数，源码就是 `supabase/functions/feishu-sync/index.ts`。

### 4. 设置后端 Secrets

Supabase Dashboard → **Edge Functions** → **Secrets** → **Add new secret**，逐项添加：

```text
FEISHU_APP_ID=cli_aa0462c624381bfb
FEISHU_APP_SECRET=（你在飞书开放平台复制的 App Secret，只在这里填写）
FEISHU_APP_TOKEN=N8KKbptymaofbHs1I3wc2MIln4e
FEISHU_TABLE_ID=tblm2o37DucTzleu
FEISHU_SYNC_WEBHOOK_SECRET=（自己随机生成一串至少 32 位字符）
AI_CLUB_SUPABASE_SECRET_KEY=（Supabase API Keys 页面中以 sb_secret_ 开头的 Secret key）
```

同时确认项目的自动 Secrets 中存在 `SUPABASE_URL`。新版项目需要将 API Keys 页面中以 `sb_secret_` 开头的 Secret key 保存为 `AI_CLUB_SUPABASE_SECRET_KEY`；函数会把它只作为 `apikey` 发送，不能放到 `Authorization: Bearer` 中。旧项目也可继续使用自动注入的 `SUPABASE_SERVICE_ROLE_KEY`。两者都是高权限密钥，只能放在 Edge Function Secrets，不能放进仓库、前端或聊天。

### 5. 建立两个 Database Webhook

进入 Supabase Dashboard → **Database** → **Webhooks** → **Create a new webhook**，目标选择 Edge Function `feishu-sync`，请求方式 POST，并添加请求头：

```text
x-feishu-sync-secret: （与 FEISHU_SYNC_WEBHOOK_SECRET 完全相同）
```

建立以下两条（也可以在一个 webhook 中勾选对应事件）：

1. `public.profiles`：勾选 **Insert**。
2. `public.submissions`：勾选 **Insert** 和 **Update**。

作业只有在完成上传后才会同步；重复提交会更新同一个学生的同一任务列，不会新增重复行。函数通过 `feishu_record_id` 记住网站账号与飞书行的对应关系，因此飞书中不会显示学号。

每次同步都会按 Supabase 中的最新数据完整刷新任务一至任务八：已提交的任务写入“已提交/勾选”，未提交的任务清空。因此负责人即使在飞书中误手动勾选，下一次同步或回填也会纠正。若误删了飞书中的某一行，函数会发现旧行不存在，自动重建姓名行并恢复数据库中已有的任务完成状态。

### 6. 回填已有账号和提交

部署并设置 Secrets 后，在浏览器或 PowerShell 向函数 URL 发送一次回填请求。函数 URL 为：

```text
https://farfmzmspladckvuduey.supabase.co/functions/v1/feishu-sync
```

请求必须带上同一个 `x-feishu-sync-secret`，JSON 内容为 `{"action":"backfill"}`。回填完成后再让新生注册和提交即可自动同步。

PowerShell 示例（把提示输入的密钥替换为你自己保存的值，切勿发到聊天）：

```powershell
$syncSecret = (Read-Host "FEISHU_SYNC_WEBHOOK_SECRET").Trim()
$headers = @{ "x-feishu-sync-secret" = $syncSecret }
Invoke-RestMethod -Method Post `
  -Uri "https://farfmzmspladckvuduey.supabase.co/functions/v1/feishu-sync" `
  -Headers $headers -ContentType "application/json" -Body '{"action":"backfill"}'
Remove-Variable syncSecret,headers
```

## 首次配置 Supabase

1. 创建 Supabase 项目。在 SQL Editor 中完整执行 `supabase/schema.sql`。
2. 按 SQL 文件末尾的注释，在 SQL Editor 中插入第一个届别邀请码。真实邀请码不要保存到仓库。
3. 打开 `js/supabase-config.js`，填写 Project URL 和 anon key / publishable key。这里只能放浏览器公开密钥，严禁填写 `service_role`、数据库密码或管理员密钥。
4. 在 Authentication → URL Configuration 中设置：
   - Site URL：`https://cyj880.github.io/ai-club-website/`
   - Redirect URLs：`https://cyj880.github.io/ai-club-website/account.html*`
   - 本地调试时另加 `http://127.0.0.1:8000/account.html*`
5. 使用首次邀请码在网站注册负责人的账号，然后在 SQL Editor 执行：

   ```sql
   update public.profiles
   set role = 'admin'
   where email = '负责人注册邮箱';
   ```

6. 管理员登录后进入 `admin.html`，即可创建或更换每届共用的邀请码。浏览器端没有提升管理员权限的接口。

如果数据库已经有测试用的旧版本，请在 SQL Editor 额外执行 `supabase/latest-only.sql`。管理员下次进入后台时会清理所有学生的旧附件和旧记录；之后每次重新提交也只保留最新一次。

本项目依靠届别邀请码控制注册，建议在 Authentication 的 Email Provider 中关闭 Confirm email，让新生注册后直接进入。邮箱仍用于登录和密码重置，因此应要求填写本人可用邮箱；如需可靠使用密码重置邮件，请配置自定义 SMTP。上线前检查 Supabase 当前免费额度，约 100 名活跃新生通常足够使用，但附件会占用 Storage 容量。

## 课程内容维护

课程目录位于 `content/course-catalog.json`。开始收作业后，课程、章节和作业的 `id` 不得修改，否则已有提交无法对应任务。标题、简介和 Markdown 文件可以继续更新。

目前 C 语言与 STM32 各提供一篇结构示例；没有对应 Markdown 文件的章节会显示“资料整理中”。将协会现有资料整理为对应文件即可逐步上线。

## 作业规则与权限

- 新生可填写作业说明、可选 HTTPS 代码链接，并上传 ZIP、PDF、PNG 或 JPEG。
- 每次提交最多 5 个文件，总计不超过 20MB；重新提交后只保留该任务的最新一次，旧附件和旧记录会自动清理。
- 访客不能读取账号数据或作业；新生只能读取自己的资料、提交和附件；管理员可以查看全部。
- 限制同时存在于数据库 RPC、RLS 和私有 Storage 策略中，不依赖前端隐藏按钮。
- 账号删除只能由负责人在 Supabase Dashboard 完成，避免把高权限密钥交给浏览器。

## 本地预览与检查

静态页面必须通过 HTTP 预览，不能直接双击 `file://`，否则课程 JSON 和 Markdown 无法加载：

```powershell
python -m http.server 8000
```

然后访问 `http://127.0.0.1:8000/`。未填写 Supabase 配置时，公开课程正常显示，账号页会明确提示尚未配置。

可用 Node.js 检查 JavaScript 语法，并验证课程目录 JSON：

```powershell
Get-ChildItem js\*.js | ForEach-Object { node --check $_.FullName }
node -e "JSON.parse(require('fs').readFileSync('content/course-catalog.json','utf8')); console.log('catalog ok')"
node scripts/validate-site.mjs
```

## 部署与密钥安全

正常情况下提交到 GitHub 后由 Pages 自动发布。如使用 `D:\zcode-work\deploy.py`，只通过当前 PowerShell 会话传入 Token：

```powershell
$env:AI_CLUB_GITHUB_TOKEN = '新生成的短期 Token'
python D:\zcode-work\deploy.py
Remove-Item Env:\AI_CLUB_GITHUB_TOKEN
```

不要创建 `.ghtoken` 文件，不要在命令历史、聊天、文档或仓库中粘贴 Token。旧交接文档中曾出现过的 Token 必须在 GitHub → Settings → Developer settings → Personal access tokens 中撤销。

## 上线验收

- 使用访客、两个新生和一个管理员账号分别测试权限边界。
- 测试错误/停用邀请码、重复学号、注册后直接登录与密码重置。
- 测试非法类型、超过 5 个文件、总大小超过 20MB、上传中断及重新提交后的旧记录清理。
- 验证新生无法通过直接 API 请求读取其他人的资料和附件。
- 分别在校园网、宿舍网和手机流量测试登录及 10MB 文件上传；若 Supabase 连通性不稳定，再迁移到国内云后端。
