# 进度日志

## 2026-04-16 Google 登录调试（已完成）

- 用户报告：点 "Sign in with Google" 后浏览器下载文件
- 根因：`.env.local` 缺 3 个 Google OAuth env vars + 路由无 try-catch → 500 无 Content-Type → 浏览器当文件下载
- 修复：添加 env vars、重启 dev server → `curl` 返回 307 + `Location: accounts.google.com`
- 生产：Railway env vars 已设 + deploy 已触发
- 待确认：Google Console 添加生产回调 URI

## 2026-04-16 邀请链接功能审计（当前）

- 用户问：这个 invitation 功能做完了吗？想实现 "分享一个链接 → 别人点了就能用 APP"
- 审计结论：**未实现**，只有内部 "加已有用户进订阅" 的脚手架
- 代码证据记在 `findings.md`
- 实施计划记在 `task_plan.md`：7 个 phase
- 下一步：用户对齐 4 个决策点（邀请范围 / 过期 / maxUses / 预览页）后开 Phase 1
