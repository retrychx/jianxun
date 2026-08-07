#!/bin/bash
set -e

echo "╔══════════════════════════════════════╗"
echo "║     简讯 · Cloudflare 部署脚本      ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ─── Check wrangler login ───
if ! npx wrangler whoami &>/dev/null; then
  echo "👉 请先登录 Cloudflare："
  echo "   npx wrangler login"
  exit 1
fi

# ─── D1 database ───
DB_ID=$(grep 'database_id' apps/api/wrangler.toml | head -1 | sed 's/.*= "//;s/"//')

if [ -z "$DB_ID" ] || [ "$DB_ID" = "YOUR_DATABASE_ID" ]; then
  echo "📦 创建 D1 数据库..."
  DB_INFO=$(npx wrangler d1 create jianxun 2>&1)
  DB_ID=$(echo "$DB_INFO" | grep -o 'database_id.*' | sed 's/database_id = "//;s/"//')

  if [ -z "$DB_ID" ]; then
    echo "❌ 创建失败，可能已存在。尝试获取已有数据库 ID..."
    DB_ID=$(npx wrangler d1 list --json 2>/dev/null | python3 -c "import sys,json; dbs=json.load(sys.stdin); print([d['uuid'] for d in dbs if d['name']=='jianxun'][0])" 2>/dev/null || echo "")
  fi

  if [ -n "$DB_ID" ]; then
    echo "✅ D1 数据库 ID: $DB_ID"
    # Update apps/api/wrangler.toml
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s/database_id = \"\"/database_id = \"$DB_ID\"/" apps/api/wrangler.toml
    else
      sed -i "s/database_id = \"\"/database_id = \"$DB_ID\"/" apps/api/wrangler.toml
    fi
  else
    echo "❌ 无法获取 D1 数据库 ID，请手动创建："
    echo "   npx wrangler d1 create jianxun"
    echo "   然后把 database_id 填到 apps/api/wrangler.toml"
    exit 1
  fi
else
  echo "✅ D1 数据库 ID: $DB_ID"
fi

# ─── Migrate ───
echo ""
echo "🗄️  运行数据库迁移（--remote 迁移生产库，不加则只迁移本地）..."
cd apps/api && npx wrangler d1 migrations apply jianxun --remote

# ─── DeepSeek API Key ───
echo ""
if [ -z "$(npx wrangler secret list 2>/dev/null | grep DEEPSEEK_API_KEY)" ]; then
  echo "🔑 设置 DeepSeek API Key..."
  echo "   请输入你的 DeepSeek API Key（输入后不可见）："
  read -s API_KEY
  if [ -n "$API_KEY" ]; then
    # printf（而非 echo）避免把末尾换行符写进 secret，导致鉴权头带 \n 而失效
    printf '%s' "$API_KEY" | npx wrangler secret put DEEPSEEK_API_KEY
    echo "✅ API Key 已设置"
  else
    echo "⚠️  跳过，可稍后通过 npx wrangler secret put DEEPSEEK_API_KEY 设置"
  fi
else
  echo "✅ DeepSeek API Key 已设置"
fi

# ─── Admin Token（保护写接口） ───
echo ""
if [ -z "$(npx wrangler secret list 2>/dev/null | grep ADMIN_TOKEN)" ]; then
  echo "🔐 设置 ADMIN_TOKEN（写接口鉴权）..."
  echo "   请输入你的 ADMIN_TOKEN（输入后不可见；不要打印到终端/日志）："
  read -s ADMIN_TOKEN
  if [ -n "$ADMIN_TOKEN" ]; then
    printf '%s' "$ADMIN_TOKEN" | npx wrangler secret put ADMIN_TOKEN
    echo "✅ ADMIN_TOKEN 已设置（GitHub Actions 也需要它，请配置到仓库 secrets）"
  else
    echo "⚠️  跳过，可稍后通过 npx wrangler secret put ADMIN_TOKEN 设置"
  fi
else
  echo "✅ ADMIN_TOKEN 已设置"
fi

# ─── Build ───
echo ""
echo "🔨 构建前端..."
pnpm build

# ─── Deploy ───
echo ""
echo "🚀 部署到 Cloudflare Pages（config 式部署，确保 functions/ 一起发布）..."
cd apps/api && npx wrangler pages deploy --branch main

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   ✅ 部署完成！                                       ║"
echo "║                                                      ║"
echo "║   首次抓取（写接口需 ADMIN_TOKEN）：                  ║"
echo "║   curl -X POST -H \"Authorization: Bearer <TOKEN>\"   ║"
echo "║     https://jianxun.pages.dev/api/news/fetch         ║"
echo "║                                                      ║"
echo "║   之后由 GitHub Actions 每 3 小时自动抓取             ║"
echo "╚══════════════════════════════════════════════════════╝"
