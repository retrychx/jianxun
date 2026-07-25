# 简讯 · AI 智能新闻聚合

每日自动抓取 35+ 中英文科技/财经/科学资讯，AI 自动分类、摘要、实体识别、情感分析。

## 技术栈

| 层 | 技术 |
|---|---|
| **前端** | React 19 + Vite 8 + TypeScript 7 |
| **后端** | Cloudflare Workers + Hono + D1 |
| **AI** | DeepSeek API（分类/摘要/实体/情感） |
| **RSS** | 35 个中英文源，rss-parser |
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

```bash
# 安装依赖
pnpm install

# 启动前后端（前端 Vite + 后端 NestJS）
pnpm dev

# 访问
# http://localhost:5173
```

> 后端默认使用 NestJS + SQLite（better-sqlite3）用于本地开发。
> 部署到 Cloudflare 时自动切换为 Workers + D1。

### 环境变量

```bash
# 根目录创建 .env
echo "DEEPSEEK_API_KEY=sk-your-key" > .env
```

不设置时使用关键词分类，设置后启用 AI 分析。

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

脚本会自动完成：创建 D1 数据库 → 运行迁移 → 设置 API Key → 构建 → 部署。

### 手动部署

```bash
# 1. 创建 D1 数据库
npx wrangler d1 create jianxun
# → 把 database_id 填到 wrangler.toml

# 2. 运行迁移
npx wrangler d1 migrations apply jianxun

# 3. 设置 DeepSeek API Key
npx wrangler secret put DEEPSEEK_API_KEY

# 4. 构建 + 部署
pnpm build
npx wrangler pages deploy --branch main
```

### 首次抓取

部署后在浏览器访问：

```
https://jianxun.pages.dev/api/news/fetch
```

或使用 curl：

```bash
curl https://你的域名.pages.dev/api/news/fetch
```

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
│   └── _worker.ts          # Cloudflare Worker API
├── src/
│   ├── sources.ts           # RSS 源列表
│   ├── rss.ts               # RSS 抓取
│   ├── classifier.ts        # AI 分类器
│   └── analysis.ts          # 内容提取 + DeepSeek 分析
├── packages/
│   ├── frontend/            # React + Vite 前端
│   └── backend/             # NestJS 本地开发后端
├── migrations/              # D1 数据库迁移
├── scripts/deploy.sh        # 一键部署脚本
├── wrangler.toml            # Cloudflare 配置
└── README.md
```

## License

MIT
