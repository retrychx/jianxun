export type NewsCategory =
  | 'AI' | '科技' | '财经' | '政治' | '社会' | '体育'
  | '娱乐' | '游戏' | '国际' | '健康' | '教育' | '其他'

export function keywordClassify(title: string, description?: string | null, lang = 'zh'): { category: NewsCategory; score: number } {
  const t = (title + ' ' + (description || '')).toLowerCase()
  const isEn = lang === 'en'

  // ─── AI / ML ───
  if (/ai |artificial intelligence|gpt-?4?|o3|llm|大模型|机器学习|deepseek|机器人|neural network|transformer|openai|claude|bard|gemini|llama|mistral|agi|autonomous|cobot|computer vision|nlp|chatbot|推荐系统|智能体|agent|多模态|diffusion|fine.?tun|hugging.?face|langchain|prompt|rag |benchmark|dataset|model training|inference|gpu cluster|rlhf|alignment|sora|gen.?ai|generative ai|deep.?learning|reinforcement learning|supervised|unsupervised|embedding|token|vector database|ai.?powered|ai.?driven|ai.?native/.test(t)) return { category: 'AI', score: 80 }

  // ─── 科技硬件/软件 ───
  if (/iphone|apple|华为|小米|oppo|vivo|芯片|gpu|cpu|5g|6g|手机|电脑|笔记本|平板|显示器|显示器|耳机|穿戴|smartphone|laptop|tablet|wearable|startup|saas|cloud|数据|data?center|algorithm|browser|os |operating system|android|ios|windows|linux|quantum|cyber|security|vulnerability|hack|oem|专利|pixel|samsung|amazon|meta |google |microsoft|腾讯|百度|字节|美团|京东|拼多多|滴滴|twitter|x\.com|threads|telegram|whatsapp|signal|开源|open.?source|github|gitlab|docker|kubernetes|api|sdk|framework/.test(t)) return { category: '科技', score: 70 }

  // ─── 财经/投融资 ───
  if (/股票|基金|比特币|以太坊|crypto|blockchain|web3|nft|defi|美元|央行|降息|加息|通胀|ipo|merger|acquisition|revenue|profit|earnings|market|investor|融资|估值|上市|投资|收购|并购|退出|venture|pitch|种子轮|天使轮|a轮|b轮|c轮|独角兽|估值|财报|营收|净利润|市值|股东|董事/.test(t)) return { category: '财经', score: 70 }

  // ─── 国际 ───
  if (/联合国|欧盟|俄罗斯|美国|中国|日本|韩国|印度|外交|大使|制裁|war |military|navy|treaty|summit|北约|g7|g20|geopolit|embassy|ambassador|tariff|trade.?war|foreign|global|world|international|overseas/.test(t)) return { category: '国际', score: 65 }

  // ─── 政治 ───
  if (/拜登|特朗普|普京|泽连斯基|选举|国会|议会|senate|congress|govern|president|prime minister|vote|democrat|republican|政策|立法|法案|gov|administration|白宫|议会|州长|总统/.test(t)) return { category: '政治', score: 65 }

  // ─── 健康/医疗 ───
  if (/疫情|疫苗|covid|cancer|手术|健康|医疗|hospital|drug|patient|治疗|药物|clinical|biotech|gene|dna|brain|health|fda|临床试验|患者|医生|医院|诊断|疗法|心理健康|mental.?health/.test(t)) return { category: '健康', score: 60 }

  // ─── 体育 ───
  if (/nba|英超|欧冠|世界杯|奥运|足球|篮球|soccer|tennis|f1 |gp |championship|olympic|athlete|选手|冠军|决赛|赛季|转会|签约|教练|体育/.test(t)) return { category: '体育', score: 60 }

  // ─── 娱乐 ───
  if (/电影|音乐|综艺|明星|票房|netflix|hollywood|oscar|album|concert|streaming|trailer|actor|导演|entertainment|tiktok|youtube|instagram|spotify|迪士尼|漫威|dc |hbo|apple.?tv|amazon.?prime|film|movie|tv.?show|celebrity/.test(t)) return { category: '娱乐', score: 60 }

  // ─── 游戏 ───
  if (/playstation|xbox|switch|steam|原神|gaming|rpg|fps|nintendo|pc gaming|esport|游戏|电竞|pubg|fortnite|minecraft|roblox|epic|unity|unreal|游戏机|掌机|手游/.test(t)) return { category: '游戏', score: 60 }

  // ─── 教育 ───
  if (/教育|高考|考研|留学|大学|school|university|student|professor|academic|phd|research|study|classroom|课程|学位|论文|学者|奖学金|edu/.test(t)) return { category: '教育', score: 60 }

  // ─── 社会 ───
  if (/地震|台风|事故|犯罪|法院|警方|climate|weather|flood|fire|police|crime|protest|法律|环保|污染|能源|新能源|solar|wind|renewable|electric.?vehicle|ev |carbon|排放/.test(t)) return { category: '社会', score: 60 }

  // Default
  return { category: isEn ? '科技' : '科技', score: 50 }
}
