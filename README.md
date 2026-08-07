# 简讯 · AI 智能新闻聚合

每日自动抓取 48 个中英文科技/财经/科学资讯，AI 自动分类、摘要、实体识别、情感分析。

## 技术栈

| 层 | 技术 |
|---|---|
| **前端** | React 19 + Vite 8 + TypeScript 7 |
| **后端** | Cloudflare Pages Functions + D1 + KV |
| **AI** | DeepSeek API（分类/摘要/实体/情感） |
| **RSS** | 48 个中英文源，自研轻量解析 |
| **DB** | Cloudflare D1（SQLite） |

## 功能

- 48 个 RSS 源自动抓取（36氪、TechCrunch、Hacker News、GitHub Trending 等）
- AI 自动分类（科技/AI/财经/国际/游戏等 12 类）
- 话题聚类 — 同一话题的不同来源聚合
- AI 摘要 + 关联实体 + 情感分析
- 多源对比 — 同一事件不同媒体的报道角度
- **叙事追踪** — 跨周期故事线（首次信号 → 逐日进展 → 展望的故事弧视图）
- **每日日报** — AI 精选当日要闻（按你的关注实体个性化置顶）
- **每日产品灵感** — agent 基于当天热门新闻生成 1-3 个可孵化 demo 的产品想法
- **个性化 feed** — 关注 + 兴趣 + 点击热实体加权，可"只看重要"/屏蔽来源
- **读者洞察** — 点击数据驱动的统计（热门实体/升温/最多阅读）
- **追更订阅** — 关注叙事/实体，有新进展时推送通知
- **AI 问答 + 深度研究** — 时间感知检索
- 暗色模式 / 复古纸报主题（打字机动画 + 打印纸详情）
- 响应式移动端适配（PWA，可安装到桌面）

## 架构与工作原理

### 数据流

```
48 个 RSS 源
  │ 定时抓取（cron-fetch Worker :23 或 GitHub Action 兜底 :47）
  ▼
fetchAllRSS → parse-rss（解析 + HTML 实体解码）→ 去重 → news 表
  │ 触发
  ▼
Agent 管线（runAgent：每小时/每 3h/手动触发）
  ├─ analyzeNewArticles     AI 分析（摘要/实体/情感/要点）
  ├─ updateNarratives       叙事匹配 + 新叙事发现
  ├─ detectBreakingNews     突发检测
  ├─ curateBriefing         AI 精选简报
  ├─ generateDailyDigest    每日日报（按北京日期去重）
  ├─ generateProductIdeas   每日产品灵感（1-3 个）
  ├─ linkEntities           实体归一
  ├─ translateMissing       英文→中文翻译
  └─ …（来源权重/争议/研究简报/叙事前瞻等）
  │ 写库
  ▼
news / narratives / signals / entity_links / agent_meta / digests
  │ 读取
  ▼
Pages Functions API（/api/news/*）→ React 前端
```

### Agent 管线机制

- **阶段化调度**：`planPhases` 根据系统状态决定跑哪些阶段（距上次运行 <2 分钟时只跑分析），各阶段有独立超时与优先级
- **并发锁**：`running` 标记防止并发 run（30 分钟残留锁自动过期）；`last_run` 记录完成时间供调度判断
- **学习反馈**：用户点击/隐藏信号 → 实体热度 → 下轮优先分析热门实体；被隐藏文章自动重分析
- **成本控制**：日报/灵感按天去重（每天只调一次 LLM）；付费调用走 single-flight 防并发重算

### 数据模型（核心表）

| 表 | 作用 |
|---|---|
| `news` | 文章 + AI 分析结果（摘要/实体/情感/要点） |
| `narratives` | 叙事：跨周期故事追踪，`developments` 存逐日进展 |
| `signals` | 用户信号（click/hide），驱动个性化与反馈闭环 |
| `entity_links` | 实体归一映射 |
| `source_stats` / `source_weights` | 信源健康与自适应权重 |
| `agent_meta` | agent 状态（last_run、日报、灵感、KPI、记忆） |
| `digests` | 每日日报 |

### 关键机制

- **缓存**：Cache API，按资源 TTL；single-flight 合并并发重算
- **鉴权与限流**：写接口统一 `ADMIN_TOKEN`（`_middleware.ts`）；付费 LLM 端点（research/ask/topic）per-IP 限流
- **时区**：日报/「今日」统计按北京时间（+8h）
- **安全**：RSS 抓取 URL 校验防 SSRF；实体名 LIKE 转义；错误信息脱敏

### 定时任务

| 任务 | 频率 | 作用 |
|---|---|---|
| `cron-fetch` Worker | 每小时 :23 | 主抓取 + 触发 agent |
| `cron-analyze` Worker | 每 3h :05 | 跑 agent 管线 |
| GitHub Action `fetch.yml` | 每小时 :47 | 兜底抓取（worker 停摆时保底） |
| GitHub Action `health-check.yml` | 每小时 :07 | 检查抓取/agent/日报新鲜度，异常建 issue |
| GitHub Action `d1-backup.yml` | 每周 | 导出 D1 备份 |

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

# 2. 运行迁移（--remote 迁移生产库）
npx wrangler d1 migrations apply jianxun --remote

# 3. 设置 secrets（ADMIN_TOKEN 保护写接口）
npx wrangler pages secret put DEEPSEEK_API_KEY
npx wrangler pages secret put ADMIN_TOKEN

# 4. 构建 + 部署（config 形式，确保 functions/ 一起发布）
pnpm build
npx wrangler pages deploy --project-name jianxun --branch main
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

共 48 个源，覆盖中英文科技、财经、科学、开源、AI：

<details>
<summary>中文源（16 个）</summary>

36氪、少数派、爱范儿、量子位、钛媒体、雷锋网、品玩、Solidot、
中国新闻网、美团技术、凤凰网科技、IT之家、掘金、博客园、小众软件、开源中国
</details>

<details>
<summary>英文源（32 个）</summary>

Hacker News、TechCrunch、The Verge、Ars Technica、Wired、Engadget、Dev.to、
Android Central、New Scientist、ScienceDaily、Space.com、NPR、Nature、
Quanta Magazine、IEEE Spectrum、Physics World、MIT News、GitHub Blog、
Simon Willison、arXiv AI、arXiv Robot、OpenAI、MIT Tech Review、
VentureBeat AI、Phoronix、LWN、动点科技、ZDNet、MarketWatch、Fortune、Live Science、phys.org
</details>

> 源列表在 `src/sources.ts`，可自由增删；`weight` 控制排序权重（UGC/SEO 重的源降低权重）。

## 项目结构

```
jianxun/
├── functions/
│   └── api/                 # Cloudflare Pages Functions API（含 _middleware 统一鉴权）
├── src/                     # Functions 共享代码
│   ├── agent/               # Agent 管线（阶段化调度、叙事、灵感、反馈闭环、记忆）
│   ├── api/                 # 读/写业务逻辑（listNews、digest、write 等）
│   ├── analysis/            # DeepSeek 集成 + prompts
│   ├── sources.ts           # RSS 源列表
│   ├── rss.ts / parse-rss.ts # 抓取与解析（含 HTML 实体解码）
│   ├── topics.ts            # 话题聚类
│   └── helpers.ts / handler.ts / cache.ts
├── packages/
│   └── frontend/            # React 前端（views + hooks + components）
├── migrations/              # D1 数据库迁移（0014 索引/限流、0015 FTS trigram）
├── workers/                 # cron-fetch / cron-analyze Workers
├── tests/                   # vitest（真实 SQLite + 路由冒烟测试）
├── .github/workflows/       # 部署 / 兜底抓取 / 健康监控 / D1 备份
├── scripts/deploy.sh        # 一键部署脚本
├── wrangler.toml            # Cloudflare 配置
└── README.md
```

## License

MIT
