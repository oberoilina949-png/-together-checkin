# 同行 · TOGETHER

微信内可打开的双人健康习惯打卡网站。一个人创建空间，把邀请链接发给好友，两个人分别用昵称和密码登录，云端共享每日打卡记录、日历和留言。

## 第一版功能
- 创建双人空间，7 天有效的加入邀请；空间最多两名成员
- 独立账号与会话 Cookie；密码以 scrypt 加盐哈希保存
- 规律饮食、适量运动、饮水、睡眠四项每日打卡，支持修改和撤销
- 连续打卡天数、共同打卡天数、双人日历
- 彼此可见的留言、仅本人可见的今日备注
- 无需微信公众号或小程序，使用 HTTPS 地址在微信聊天内直接打开

## 运行环境
Node.js 20+、Express、PostgreSQL。前端为 public/index.html，移动端优先设计。

## Render 部署步骤
1. 先在 Render Workspace 完成付款方式验证。目前该账户 API 在尝试创建 **free 免费 Web Service 和免费数据库** 时均返回 402：Payment information is required。**目前没有创建成功的服务或可用的微信链接。**
2. 创建 PostgreSQL 数据库，推荐与 Web Service 同地区（Singapore）。请注意 **Render 免费 PostgreSQL 仅限约 30 天试用并非长期可靠存储**；长期记录建议迁移到持久数据库并开启备份。
3. 创建新的 **Free** Web Service，关联仓库 `oberoilina949-png/-together-checkin`，分支 `main`。
4. Runtime Node；Build command `npm install --omit=dev`；Start command `npm start`。
5. 环境变量：`DATABASE_URL` 设置为数据库的 internal URL；`NODE_ENV=production`。
6. 数据库表会在服务启动时自动初始化。部署后查看 `/health` 是否返回 `{"ok":true}`。
7. 用两部手机分别在微信里打开 HTTPS 网站：创建空间 → 复制邀请 → 加入 → 双方打卡 → 刷新观察同步 → 退出登录并重新登录验证持久化。

## 注意
- 本仓库是公开代码仓库，**不要提交 DATABASE_URL、密码、密钥、个人打卡数据**。
- 私人数据存入 PostgreSQL，公开 GitHub 仓库只放源码。
- 两个人在中国内地的微信中是否能访问 Render 域名，还需实际测试网络连通性。
- 目前不支持自助密码找回，请保存空间编号、昵称和密码。
- GitHub Actions 工作流 `.github/workflows/verify.yml` 自动检查服务端与浏览器脚本的语法。
- 设计目标是健康习惯，不是极端节食或体重竞赛。

## 本地启动
```bash
npm install
# 将 DATABASE_URL 设置为可访问的 PostgreSQL 连接地址
npm start
```
默认监听 3000 端口。

© 2026 TOGETHER
