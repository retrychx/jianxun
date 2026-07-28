// 集中配置 — 所有环境相关常量在此处统一管理
// 避免硬编码散落在各个文件中

export const CONFIG = {
  /** 生产站点 URL */
  SITE_URL: 'https://jianxun.pages.dev',
  /** OG 站点名称 */
  OG_SITE_NAME: '简讯',
  /** Cloudflare 账户 ID（用于 worker URL） */
  CLOUDFLARE_ACCOUNT_ID: '863129776',
  /** 数据保留天数（注：articles 永远不删，agent 训练依赖历史数据） */
  RETENTION: {
    SIGNALS_DAYS: 14,
    NARRATIVE_ARCHIVE_DAYS: 30,
  },
} as const
