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
js/supabase-config.js        允许公开的 Supabase 浏览器配置
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

本项目依靠届别邀请码控制注册，建议在 Authentication 的 Email Provider 中关闭 Confirm email，让新生注册后直接进入。邮箱仍用于登录和密码重置，因此应要求填写本人可用邮箱；如需可靠使用密码重置邮件，请配置自定义 SMTP。上线前检查 Supabase 当前免费额度，约 100 名活跃新生通常足够使用，但附件会占用 Storage 容量。

## 课程内容维护

课程目录位于 `content/course-catalog.json`。开始收作业后，课程、章节和作业的 `id` 不得修改，否则历史提交无法对应任务。标题、简介和 Markdown 文件可以继续更新。

目前 C 语言与 STM32 各提供一篇结构示例；没有对应 Markdown 文件的章节会显示“资料整理中”。将协会现有资料整理为对应文件即可逐步上线。

## 作业规则与权限

- 新生可填写作业说明、可选 HTTPS 代码链接，并上传 ZIP、PDF、PNG 或 JPEG。
- 每个提交版本最多 5 个文件，总计不超过 20MB；重交会创建新版本。
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
- 测试非法类型、超过 5 个文件、总大小超过 20MB、上传中断及重交版本。
- 验证新生无法通过直接 API 请求读取其他人的资料和附件。
- 分别在校园网、宿舍网和手机流量测试登录及 10MB 文件上传；若 Supabase 连通性不稳定，再迁移到国内云后端。
