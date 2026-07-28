// 集中配置 — 所有环境相关常量在此处统一管理
// 避免硬编码散落在各个文件中

export const CONFIG = {
  /** 生产站点 URL */
  SITE_URL: 'https://jianxun.pages.dev',
  /** OG 站点名称 */
  OG_SITE_NAME: '简讯',
  /** Cloudflare 账户 ID（用于 worker URL） */
  CLOUDFLARE_ACCOUNT_ID: '863129776',
  /** 数据保留天数 */
  RETENTION: {
    ARTICLES_DAYS: 30,
    SIGNALS_DAYS: 7,
    NARRATIVE_STALE_DAYS: 14,
  },
} as const
