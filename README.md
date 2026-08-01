# 简讯 · AI 智能新闻聚合

每日自动抓取 35+ 中英文科技/财经/科学资讯，AI 自动分类、摘要、实体识别、情感分析。

## 技术栈

| 层 | 技术 |
|---|---|
| **前端** | React 19 + Vite 8 + TypeScript 7 |
| **后端** | Cloudflare Pages Functions + D1 + KV |
| **AI** | DeepSeek API（分类/摘要/实体/情感） |
| **RSS** | 35 个中英文源，自研轻量解析 |
| **DB** | Cloudflare D1（SQLite） |

## 功能

- 35 个 RSS 源自动抓取（36氪、TechCrunch、Hacker News、GitHub Trending 等）
- AI 自动分类（科技/AI/财经/国际/游戏等 12 类）
- 话题聚类 — 同一话题的不同来源聚合
- AI 摘要 + 关联实体 + 情感分析
- 多源对比 — 同一事件不同媒体的报道角度
- 暗色模式 / 复古纸报主题（打字机动画 + 打印纸详情）
- 响应式移动端适配

## 本地开发

后端是 Cloudflare Pages Functions（`functions/api/` + 共享代码 `src/`），本地用 wrangler 运行：

```bash
# 安装依赖
pnpm install

# 初始化本地 D1 数据库
npx wrangler d1 migrations apply jianxun --local

# 构建一次前端（pages dev 需要 packages/frontend/dist 存在）
pnpm build

# 启动后端（读取 wrangler.toml 绑定，端口 8788）
npx wrangler pages dev

# 另开终端启动前端
pnpm dev

# 访问
# http://localhost:5173 （Vite 把 /api 代理到 localhost:8788）
```

### 本地 secrets

在根目录创建 `.dev.vars`（已 gitignore）：

```bash
DEEPSEEK_API_KEY=sk-your-key
ADMIN_TOKEN=your-admin-token
```

不设置 `DEEPSEEK_API_KEY` 时使用关键词分类，设置后启用 AI 分析。
`ADMIN_TOKEN` 未设置时所有写接口（`/api/news/fetch`、`/api/news/fix-images`、详情 POST）一律返回 401。

## 部署到 Cloudflare

### 前置条件

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) `npm i -g pnpm`
- [Cloudflare 账号](https://dash.cloudflare.com/)

### 一键部署

```bash
# 1. 安装依赖
pnpm install

# 2. 登录 Cloudflare
npx wrangler login

# 3. 运行部署脚本
./scripts/deploy.sh
```

脚本会自动完成：创建 D1 数据库 → 运行迁移 → 设置 API Key 与 ADMIN_TOKEN → 构建 → 部署。

### 手动部署

```bash
# 1. 创建 D1 数据库
npx wrangler d1 create jianxun
# → 把 database_id 填到 wrangler.toml

# 2. 运行迁移
npx wrangler d1 migrations apply jianxun

# 3. 设置 secrets（ADMIN_TOKEN 保护写接口）
npx wrangler pages secret put DEEPSEEK_API_KEY
npx wrangler pages secret put ADMIN_TOKEN

# 4. 构建 + 部署
pnpm build
npx wrangler pages deploy --branch main
```

### 首次抓取

部署后带 token 调写接口（GET 不再可用）：

```bash
curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" \
  https://你的域名.pages.dev/api/news/fetch
```

> 生产环境无需手动抓取：`cron-fetch` Worker 每 1 小时自动 POST `/api/news/fetch`
> （`workers/cron-fetch/`，由 `deploy.yml` 部署）。需在仓库 secrets 配置与 Pages
> 相同的 `ADMIN_TOKEN`，可选 `vars.SITE_URL` 覆盖默认站点地址。

## RSS 源

共 35 个源，覆盖中英文科技、财经、科学、游戏、综合：

<details>
<summary>中文源（13 个）</summary>

36氪、少数派、爱范儿、量子位、钛媒体、雷锋网、品玩、
Solidot、V2EX 热榜、开源中国、美团技术、投资界、中国新闻网
</details>

<details>
<summary>英文源（22 个）</summary>

Hacker News、GitHub Trending、TechCrunch、The Verge、Ars Technica、
Wired、MIT Tech Review、Engadget、Dev.to、Android Central、
New Scientist、ScienceDaily、Space.com、PC Gamer、NPR
</details>

## 项目结构

```
jianxun/
├── functions/
│   └── api/                 # Cloudflare Pages Functions API
├── src/                     # Functions 共享代码
│   ├── sources.ts           # RSS 源列表
│   ├── rss.ts               # RSS 抓取
│   ├── parse-rss.ts         # RSS/Atom 解析
│   ├── classifier.ts        # 关键词分类器
│   ├── analysis.ts          # 内容提取 + DeepSeek 分析
│   └── handler.ts           # API 业务逻辑
├── packages/
│   └── frontend/            # React + Vite 前端
├── migrations/              # D1 数据库迁移
├── scripts/deploy.sh        # 一键部署脚本
├── wrangler.toml            # Cloudflare 配置
└── README.md
```

## License

MIT
