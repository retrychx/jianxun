export type NewsCategory =
  | 'AI' | '科技' | '财经' | '政治' | '社会' | '体育'
  | '娱乐' | '游戏' | '国际' | '健康' | '教育' | '其他'

export function keywordClassify(title: string, description?: string | null, lang = 'zh'): { category: NewsCategory; score: number } {
  const t = (title + ' ' + (description || '')).toLowerCase()
  const isEn = lang === 'en'

  // AI (highest priority)
  if (/ai |artificial intelligence|gpt|llm|大模型|机器学习|deepseek|机器人|neural|transformer|openai|claude|bard|llama|agi|autonomous|computer vision|nlp|chatbot|推荐系统|智能体|agent|多模态|diffusion|fine.?tun/.test(t)) return { category: 'AI', score: 75 + (isEn ? 10 : 0) }

  // 科技
  if (/iphone|apple|华为|小米|芯片|gpu|cpu|5g|6g|手机|电脑|软件|startup|saas|cloud|数据|data|algorithm|browser|os |operating system|android|ios|windows|linux|quantum|cyber|security|vulnerability|hack|oem|专利|pixel|samsung|amazon|meta |google |microsoft|腾讯|百度|字节/.test(t)) return { category: '科技', score: 65 }

  // 财经
  if (/股票|基金|比特币|以太坊|crypto|blockchain|美元|央行|降息|通胀|ipo|merger|acquisition|revenue|profit|earnings|market|investor|融资|估值|上市|投资/.test(t)) return { category: '财经', score: 65 }

  // 国际
  if (/联合国|欧盟|俄罗斯|美国|中国|日本|韩国|外交|大使|制裁|war |military|navy|treaty|summit|北约|g7|g20|geopolit/.test(t)) return { category: '国际', score: 60 }

  // 政治
  if (/拜登|特朗普|普京|选举|国会|议会|senate|congress|govern|president|prime minister|vote|democrat|republican|政策|立法/.test(t)) return { category: '政治', score: 60 }

  // 健康
  if (/疫情|疫苗|covid|cancer|手术|健康|医疗|hospital|drug|patient|治疗|药物|clinical|biotech|gene|dna|brain|health/.test(t)) return { category: '健康', score: 60 }

  // 体育
  if (/nba|英超|欧冠|世界杯|奥运|足球|篮球|soccer|tennis|f1 |gp |championship|olympic|athlete/.test(t)) return { category: '体育', score: 60 }

  // 娱乐
  if (/电影|音乐|综艺|明星|票房|netflix|hollywood|oscar|album|concert|streaming|trailer|actor|导演|entertainment/.test(t)) return { category: '娱乐', score: 60 }

  // 游戏
  if (/playstation|xbox|switch|steam|原神|gaming|rpg|fps|nintendo|pc gaming|esport|游戏|电竞/.test(t)) return { category: '游戏', score: 60 }

  // 教育
  if (/教育|高考|考研|留学|大学|school|university|student|professor|academic|phd|research|study|classroom/.test(t)) return { category: '教育', score: 60 }

  // 社会
  if (/地震|台风|事故|犯罪|法院|警方|climate|weather|flood|fire|police|crime|protest|法律/.test(t)) return { category: '社会', score: 60 }

  // Default: science/tech for English, 科技 for Chinese
  return { category: isEn ? '科技' : '科技', score: 50 }
}
