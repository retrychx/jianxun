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
DB_ID=$(grep 'database_id' wrangler.toml | head -1 | sed 's/.*= "//;s/"//')

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
    # Update wrangler.toml
    if [[ "$OSTYPE" == "darwin"* ]]; then
      sed -i '' "s/database_id = \"\"/database_id = \"$DB_ID\"/" wrangler.toml
    else
      sed -i "s/database_id = \"\"/database_id = \"$DB_ID\"/" wrangler.toml
    fi
  else
    echo "❌ 无法获取 D1 数据库 ID，请手动创建："
    echo "   npx wrangler d1 create jianxun"
    echo "   然后把 database_id 填到 wrangler.toml"
    exit 1
  fi
else
  echo "✅ D1 数据库 ID: $DB_ID"
fi

# ─── Migrate ───
echo ""
echo "🗄️  运行数据库迁移..."
npx wrangler d1 migrations apply jianxun

# ─── DeepSeek API Key ───
echo ""
if [ -z "$(npx wrangler secret list 2>/dev/null | grep DEEPSEEK_API_KEY)" ]; then
  echo "🔑 设置 DeepSeek API Key..."
  echo "   请输入你的 DeepSeek API Key（输入后不可见）："
  read -s API_KEY
  if [ -n "$API_KEY" ]; then
    echo "$API_KEY" | npx wrangler secret put DEEPSEEK_API_KEY
    echo "✅ API Key 已设置"
  else
    echo "⚠️  跳过，可稍后通过 npx wrangler secret put DEEPSEEK_API_KEY 设置"
  fi
else
  echo "✅ DeepSeek API Key 已设置"
fi

# ─── Build ───
echo ""
echo "🔨 构建前端..."
pnpm build

# ─── Deploy ───
echo ""
echo "🚀 部署到 Cloudflare Pages..."
npx wrangler pages deploy --branch main

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   ✅ 部署完成！                       ║"
echo "║                                      ║"
echo "║   首次部署后，执行以下命令抓取新闻：   ║"
echo "║   curl https://jianxun.pages.dev/api/news/fetch  ║"
echo "╚══════════════════════════════════════╝"
