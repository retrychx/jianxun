// SEO helper: build HTML page with OG meta tags + redirect to hash route
export function seoPage(opts: {
  title: string
  description: string
  image?: string | null
  url: string
  type?: string
}): Response {
  const { title, description, image, url, type = 'article' } = opts
  const hashUrl = url.startsWith('/') ? `/#${url}` : url

  return new Response(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${escHtml(title)} - 简讯</title>
<meta name="description" content="${escHtml(description)}"/>
<meta property="og:site_name" content="简讯"/>
<meta property="og:title" content="${escHtml(title)}"/>
<meta property="og:description" content="${escHtml(description)}"/>
<meta property="og:type" content="${type}"/>
<meta property="og:url" content="https://jianxun.pages.dev${url}"/>
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
