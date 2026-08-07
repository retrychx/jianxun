/**
 * Shared text tokenizer: CJK longest-match with tech dictionary + English word split.
 * Used by topic clustering, related-article matching, and search.
 *
 * The tech dictionary improves Chinese segmentation quality for common tech terms
 * over the pure n-gram approach, without needing a full NLP library.
 */

// Domain-specific tech terms for longest-match Chinese segmentation
const TECH_DICT: string[] = [
  // AI/ML
  '人工智能', '机器学习', '深度学习', '大语言模型', '大模型', '自然语言处理',
  '神经网络', '计算机视觉', '强化学习', '推荐系统', '知识图谱',
  '生成式AI', '多模态', '向量数据库', '智能体', '自主驾驶',
  '人脸识别', '语音识别', '机器翻译', '数据分析', '数据挖掘',
  // Companies & products
  'ChatGPT', 'GPT-4', 'GPT-4o', 'Copilot', 'Gemini', 'Claude', 'LLaMA', 'Mistral',
  'iPhone', 'iPad', 'MacBook', 'Vision Pro', 'AirPods', 'Apple Watch',
  'Android', 'Windows', 'Linux', 'iOS', 'iPadOS', 'macOS', 'visionOS',
  'RTX 5090', 'RTX 4090', 'RTX 5080', 'RTX 4080', 'Blackwell', 'Hopper',
  'PlayStation', 'Xbox', 'Switch', 'Steam Deck',
  // Concepts
  '开源', '云计算', '边缘计算', '量子计算', '区块链', 'Web3',
  '元宇宙', '增强现实', '虚拟现实', '混合现实', '自动驾驶',
  '5G', '6G', '物联网', '数字化转型', '信息安全', '网络安全',
  '芯片', '半导体', '处理器', 'GPU', 'CPU', '数据中心',
  '跨境电商', '直播电商', '社交电商', '新零售',
  // Chinese tech media / common phrases
  '自动驾驶', '新能源汽车', '电动汽车', '动力电池', '锂电池',
  '生物技术', '基因编辑', '创新药', '医疗器械',
  '独角兽', 'IPO', '融资', '估值', '上市',
].sort((a, b) => b.length - a.length) // Longest first for greedy matching

export function tokenize(text: string): string[] {
  if (!text) return []
  const tokens = new Set<string>()

  // Extract Latin words
  const latinMatches = text.match(/[A-Za-z0-9][A-Za-z0-9+.#-]{1,}/g) || []
  for (const w of latinMatches) {
    if (w.length > 1) tokens.add(w.toLowerCase())
  }

  // Chinese text (remove Latin characters for CJK processing)
  const cn = text.replace(/[a-zA-Z0-9]/g, ' ')

  // Longest-match segmentation using tech dictionary
  let remaining = cn
  while (remaining.length > 0) {
    // Skip non-CJK characters (spaces, punctuation)
    if (!/[一-鿿]/.test(remaining[0])) {
      remaining = remaining.slice(1)
      continue
    }
    let matched = false
    for (const term of TECH_DICT) {
      if (remaining.startsWith(term)) {
        tokens.add(term)
        remaining = remaining.slice(term.length)
        matched = true
        break
      }
    }
    if (!matched) {
      // Fallback: single CJK character (keeps 2+ length, skip solo chars)
      remaining = remaining.slice(1)
    }
  }

  // Also generate bigrams/trigrams for non-dict words (fallback)
  const cnClean = cn.replace(/\s+/g, '')
  for (let i = 0; i < cnClean.length - 1; i++) {
    const seg = cnClean.slice(i, i + 3)
    if (seg.length >= 2 && seg.trim()) tokens.add(seg)
  }

  return [...tokens].filter(w => w.length > 1)
}
