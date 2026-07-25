import { Injectable, Logger } from '@nestjs/common'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name)
  private readonly headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  }

  /** 抓取并提取新闻正文 */
  async extract(url: string): Promise<string | null> {
    const html = await this.fetchPage(url)
    if (!html) return null
    try {
      const dom = new JSDOM(html, { url })
      const article = new Readability(dom.window.document).parse()
      return article?.textContent?.trim()?.slice(0, 10_000) || null
    } catch (e) {
      this.logger.warn(`Readability 解析失败 ${url}: ${(e as Error).message}`)
      return null
    }
  }

  /** 提取 OG 图片 */
  async extractImage(url: string): Promise<string | null> {
    const html = await this.fetchPage(url)
    if (!html) return null
    try {
      const dom = new JSDOM(html, { url })
      const doc = dom.window.document
      // og:image
      const og = doc.querySelector('meta[property="og:image"]')?.getAttribute('content')
      if (og) return og
      // twitter:image
      const tw = doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content')
      if (tw) return tw
      // 第一张大图
      const img = doc.querySelector('article img, .content img, main img') as HTMLImageElement | null
      if (img?.src && img.src.startsWith('http')) return img.src
      return null
    } catch {
      return null
    }
  }

  /** 提取正文 + 图片（一次性） */
  async extractAll(url: string): Promise<{ content: string | null; image: string | null }> {
    const html = await this.fetchPage(url)
    if (!html) return { content: null, image: null }

    try {
      const dom = new JSDOM(html, { url })
      const doc = dom.window.document

      // 图片
      let image: string | null = null
      const og = doc.querySelector('meta[property="og:image"]')?.getAttribute('content')
      if (og) image = og
      if (!image) {
        const img = doc.querySelector('article img, .content img, main img') as HTMLImageElement | null
        if (img?.src && img.src.startsWith('http')) image = img.src
      }

      // 正文
      const article = new Readability(doc).parse()
      const content = article?.textContent?.trim()?.slice(0, 10_000) || null

      return { content, image }
    } catch (e) {
      this.logger.warn(`提取失败 ${url}: ${(e as Error).message}`)
      return { content: null, image: null }
    }
  }

  private async fetchPage(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, { headers: this.headers, signal: AbortSignal.timeout(15_000) })
      if (!res.ok) return null
      return await res.text()
    } catch {
      return null
    }
  }
}
