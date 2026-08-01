/**
 * 停用词（生成关键词/叙事时过滤）——topics 与 narrative 共用的单一事实源。
 * 注意：helpers.ts 里另有一份用于 fallbackLabel 的英文停用词，用途不同，未合并。
 */
export const STOPWORDS = new Set([
  'a','an','the','to','in','of','for','on','with','at','by','from','as','is','it','its',
  'and','or','but','not','this','that','are','was','been','will','has','had','have',
  'about','into','through','during','before','after','between','under','over',
  'what','why','how','all','each','their','our','your','new','more','most','some',
  'any','just','also','very','can','would','could','should','may','might','than',
  'then','now','up','out','off','down',
  'ai','app','day','data','one','two','top','big','get','make','use','say','set',
  'air','ultra','pro','max','mini','lite',
  '21','22','23','24','25','26','27','28','29','30',
  '8217','8217;','amp;','lt;','gt;','nbsp;',
])
