import { CONFIG } from '../../../src/config'

export function ogPage(opts: {
  title: string
  description: string
  image?: string | null
  slug: string
  type?: string
}): Response {
  const { title, description, image, slug, type = 'article' } = opts
  const url = `/${slug}`
  const hashUrl = `/#/${slug}`
  const siteUrl = CONFIG.SITE_URL

  return new Response(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${escHtml(title)} - ${CONFIG.OG_SITE_NAME}</title>
<meta name="description" content="${escHtml(description)}"/>
<meta property="og:site_name" content="${CONFIG.OG_SITE_NAME}"/>
<meta property="og:title" content="${escHtml(title)}"/>
<meta property="og:description" content="${escHtml(description)}"/>
<meta property="og:type" content="${type}"/>
<meta property="og:url" content="${siteUrl}${url}"/>
${image ? `<meta property="og:image" content="${escHtml(image)}"/>` : ''}
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escHtml(title)}"/>
<meta name="twitter:description" content="${escHtml(description)}"/>
${image ? `<meta name="twitter:image" content="${escHtml(image)}"/>` : ''}
<script>location.href='${escHtml(hashUrl)}'</script>
</head>
<body>
<h1>${escHtml(title)}</h1>
<p>${escHtml(description)}</p>
<p><a href="${hashUrl}">查看详情</a></p>
</body>
</html>`, {
    headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'public,max-age=3600' },
  })
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
