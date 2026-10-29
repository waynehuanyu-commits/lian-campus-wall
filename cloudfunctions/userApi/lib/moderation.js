const OUTCOMES = {
  EMERGENCY_BLOCK: 'emergency_block',
  REJECT: 'rejected',
  MANUAL_REVIEW: 'manual_review',
  EDIT_REQUIRED: 'edit_required',
  PASS: 'approved',
  PENDING: 'pending'
}

const SEVERITY = {
  emergency_block: 50,
  rejected: 40,
  manual_review: 30,
  edit_required: 20,
  approved: 10,
  pending: 0
}

const CONTACT_ALLOWED_CHANNELS = ['二手闲置流转', '出行拼车', '拼单互助', '求物求助', '失物招领']

const SIGNAL_TYPES = [
  { id: 'academic_core', label: '明确学业违规词' },
  { id: 'academic_variant', label: '缩写暗语' },
  { id: 'request_intent', label: '需求意图' },
  { id: 'provider_intent', label: '供给意图' },
  { id: 'transaction', label: '交易证据' },
  { id: 'contact_intent', label: '联系意图' },
  { id: 'course_time', label: '课程时间' },
  { id: 'discussion', label: '讨论例外' },
  { id: 'fraud_core', label: '诈骗词' },
  { id: 'fraud_recruit', label: '招募收益' },
  { id: 'doxx_intent', label: '挂人曝光' },
  { id: 'privacy_target', label: '隐私对象' },
  { id: 'serious_accusation', label: '严重指控' },
  { id: 'rumor_marker', label: '传闻标记' },
  { id: 'official_impersonate', label: '冒充官方' },
  { id: 'violence_call', label: '行动号召' },
  { id: 'help_seek', label: '单纯求助' },
  { id: 'politics_entity', label: '政治实体' },
  { id: 'politics_attack', label: '攻击煽动' },
  { id: 'politics_highrisk', label: '涉政高危' },
  { id: 'politics_context', label: '思政学习语境' },
  { id: 'adult_core', label: '明确色情约炮' },
  { id: 'dating_solicit', label: '约会社交引流' },
  { id: 'adult_hint', label: '色情擦边' },
  { id: 'abuse_core', label: '人身辱骂脏话' },
  { id: 'fraud_lend', label: '借贷套现' },
  { id: 'gambling_core', label: '博彩赌博' },
  { id: 'hate_core', label: '极端仇恨' },
  { id: 'voyeur_privacy', label: '偷拍隐私曝光' },
  { id: 'rebate_promo', label: '返利代理引流' }
]

const DEFAULT_LEXICONS = {
  academic_core: ['代课', '替课', '代签到', '代刷脸', '代考', '替考', '论文代写', '作业代做', '网课代刷', '考试答案', '泄题', '改成绩'],
  academic_variant: ['dk', 'd k', 'd·k', 'd_k', '带k', '带棵', 'qd', 'q d', '帮签'],
  request_intent: ['找人', '有没有人', '谁能', '来个人', '急需', '帮我', '替我'],
  provider_intent: ['可接', '接单', '长期接', '包过', '有需要找我'],
  transaction: ['有偿', '红包', '报酬', '报价', '多少钱', '多少米', '日结', '定金', '面议'],
  contact_intent: ['私我', '联系我', '加我vx', '加v', '加微信', '私聊'],
  course_time: ['高数', '英语', '明早', '今晚', '明天', '第一节', '周三', '教室', '老师', '线代', '大物'],
  discussion: ['是什么意思', '校规', '处分', '讨论', '提醒', '举报', '如何投诉', '不要找'],
  fraud_core: ['刷单', '刷单兼职', '兼职刷单', '刷信誉', '刷好评', '刷钻', '招刷手', '刷手招募', '垫付', '垫资', '返佣', '跑分', '出租银行卡', '洗钱'],
  fraud_recruit: ['兼职点赞', '日赚', '稳赚', '高收益', '招兼职', '兼职刷', '躺赚', '稳赚不赔', '0投资', '无需本金'],
  doxx_intent: ['挂人', '人肉', '曝光', '避雷'],
  privacy_target: ['宿舍', '学号', '人脸', '寝室号'],
  serious_accusation: ['贪污', '投毒', '性侵', '集体中毒', '重大事故', '死亡'],
  rumor_marker: ['听说', '网传', '内部消息', '有人说'],
  official_impersonate: ['官方通知', '紧急停课', '停课通知', '学校宣布', '学院通知', '园区通知', '经学校研究决定'],
  violence_call: ['围堵', '冲击', '破坏', '堵他', '打他', '砸了'],
  help_seek: ['求助', '求救', '有危险'],
  politics_entity: ['共产党', '中国共产党', '党中央', '中央政府', '国家主席', '总书记', '国务院', '人大代表', '政协', '社会主义制度', '现行体制'],
  politics_attack: ['打倒', '推翻', '颠覆', '独裁', '专制', '暴政', '下台', '亡党', '反动派', '造反', '武装起义'],
  politics_highrisk: ['法轮功', '大法弟子', '台独', '藏独', '疆独', '港独', '分裂国家', '颠覆国家政权', '煽动颠覆'],
  politics_context: ['党史', '党课', '入党', '党支部', '党建', '团课', '思政', '马原', '毛概', '近代史', '主题教育', '学习强国'],
  adult_core: ['约炮', '约个炮', '一夜情', '炮友', '找炮友', '色情', '黄色网站', '裸聊', '援交', '包养', '卖淫', '嫖娼', '性爱视频', '色情服务'],
  dating_solicit: ['同城约会', '约见面', '约个会', '约个女', '约个男', '约妹妹', '约哥哥', '上门服务', '附近约', '开房', '约睡', '同城约'],
  adult_hint: ['爱欲狂欢', '爱欲', '色气', '涩涩', '开车车', '搞黄色', '看片资源', '黄片', 'av资源'],
  abuse_core: ['傻逼', '傻b', '傻叉', '傻缺', 'nmsl', '去死', '滚你妈', '你妈逼', '他妈的', '你妈的', '草泥马', '操你妈', '操他妈', '他妈逼', '狗日的', '贱人', '贱货', '婊子', '脑残', '智障', '弱智', '白痴', '蠢猪', '废物'],
  fraud_lend: ['网贷', '小额贷', '放贷', '借贷', '套现', '信用卡套现', '高利贷', '借钱中介', '贷款中介', '下款快', '黑户可贷'],
  gambling_core: ['博彩', '赌球', '赌博', '六合彩', '赌场', '押注', '下注', '菠菜', '时时彩', '竞彩内幕', '赌资'],
  hate_core: ['种族灭绝', '屠华', '杀光', '滚出中国', '纳粹', '灭族', '仇恨宣传'],
  voyeur_privacy: ['偷拍', '偷窥', '裸照流出', '隐私曝光', '开盒', '人肉搜索', '厕所偷拍', '更衣室偷拍'],
  rebate_promo: ['返利', '返佣', '拉新返现', '代理招商', '一级代理', '多级分销', '裂变拉新']
}

const T2S_PAIRS = [
  ['學', '学'], ['課', '课'], ['簽', '签'], ['寫', '写'], ['試', '试'], ['題', '题'],
  ['東', '东'], ['車', '车'], ['閑', '闲'], ['餘', '余'], ['與', '与'], ['於', '于'],
  ['後', '后'], ['時', '时'], ['間', '间'], ['號', '号'], ['碼', '码'], ['經', '经'],
  ['過', '过'], ['園', '园'], ['區', '区'], ['師', '师'], ['幫', '帮'], ['讓', '让'],
  ['裏', '里'], ['裡', '里'], ['麼', '么'], ['麽', '么'], ['訊', '讯'], ['聯', '联'],
  ['係', '系'], ['嗎', '吗'], ['錢', '钱'], ['銀', '银'], ['廣', '广'], ['報', '报'],
  ['價', '价'], ['場', '场'], ['處', '处'], ['論', '论'], ['業', '业'], ['網', '网'],
  ['臉', '脸'], ['積', '积'], ['這', '这'], ['還', '还'], ['對', '对'], ['開', '开'],
  ['關', '关'], ['門', '门'], ['個', '个'], ['來', '来'], ['說', '说'], ['請', '请'],
  ['無', '无'], ['為', '为'], ['長', '长'], ['現', '现'], ['發', '发'], ['電', '电'],
  ['話', '话'], ['見', '见'], ['條', '条'], ['張', '张'], ['從', '从'], ['當', '当'],
  ['點', '点'], ['鐘', '钟'], ['幾', '几'], ['嗎', '吗'], ['麼', '么'], ['並', '并'],
  ['確', '确'], ['認', '认'], ['證', '证'], ['實', '实'], ['務', '务'], ['團', '团'],
  ['黨', '党'], ['軍', '军'], ['擊', '击'], ['擊', '击'], ['壞', '坏'], ['衝', '冲'],
  ['圍', '围'], ['塊', '块'], ['幣', '币'], ['員', '员'], ['專', '专'], ['屬', '属']
]

const CN_DIGIT = {
  零: '0', 〇: '0', 一: '1', 二: '2', 两: '2', 三: '3', 四: '4',
  五: '5', 六: '6', 七: '7', 八: '8', 九: '9'
}

const REQUEST_SINGLE = ['求']
const REQUEST_COMPOUND_BLOCK = ['要求', '求助', '求职', '求学', '求教', '求证', '求解', '求物', '请求', '恳求', '追求', '力求', '需求']

function toSimplified(text) {
  let next = String(text || '')
  T2S_PAIRS.forEach(([from, to]) => {
    next = next.split(from).join(to)
  })
  return next
}

function replaceChineseDigits(text) {
  return String(text || '').replace(/[零〇一二两三四五六七八九]/g, (ch) => CN_DIGIT[ch] || ch)
}

function compressRepeats(text) {
  return String(text || '')
    .replace(/([a-z\u4e00-\u9fff])\1{2,}/gi, '$1$1')
}

function stripNoise(text) {
  return String(text || '')
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/[·•・‧．。，,、；;：:！!？?\-_/\\|~～*＊#＃+＋=＝'"“”‘’（）()【】\[\]<>《》]/g, '')
}

function squeezeLetterSpaces(text) {
  let next = String(text || '')
  let prev = ''
  while (next !== prev) {
    prev = next
    next = next.replace(/([a-z])\s+(?=[a-z])/g, '$1')
    next = next.replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '$1')
  }
  return next.replace(/\s+/g, ' ').trim()
}

function applyAliases(text) {
  return String(text || '')
    .replace(/带棵/g, 'dk')
    .replace(/带k/g, 'dk')
    .replace(/帮签/g, 'qd')
    .replace(/薇信|威信|v信|微xin/g, '微信')
    .replace(/\bweixin\b/g, '微信')
    .replace(/\bwx\b/g, 'vx')
}

function normalizeText(original) {
  const originalText = String(original || '')
  const nfkc = originalText.normalize('NFKC').toLowerCase()
  const simplified = toSimplified(nfkc)
  const digitSwapped = replaceChineseDigits(simplified)
  const squeezed = squeezeLetterSpaces(digitSwapped)
  const stripped = stripNoise(squeezed)
  const compressed = compressRepeats(stripped)
  const aliased = applyAliases(compressed)
  return {
    originalText,
    simplified,
    digitSwapped,
    normalizedText: aliased.replace(/\s+/g, '')
  }
}

function uniq(list) {
  return Array.from(new Set((list || []).filter(Boolean)))
}

function extractEntities(originalText, prepared) {
  const source = `${prepared.simplified || ''} ${prepared.digitSwapped || ''} ${originalText || ''}`
  const compact = prepared.normalizedText || ''
  const phones = []
  // 不用后行断言 (?<!\d)：iOS 16.4 以下的 JSCore 不认，整个文件会解析失败导致小程序打不开
  const phoneRe = /(?:^|\D)(1[3-9]\d{9})(?!\d)/g
  let match
  const compactDigits = compact.replace(/[^\d]/g, '')
  while ((match = phoneRe.exec(source.replace(/\s+/g, ''))) !== null) phones.push(match[1])
  while ((match = phoneRe.exec(compactDigits)) !== null) phones.push(match[1])

  const qqs = []
  const qqRe = /(?:qq|扣扣)[:：\s]*([1-9]\d{4,10})/gi
  while ((match = qqRe.exec(source)) !== null) qqs.push(match[1])

  const wechats = []
  const wxRe = /(?:微信号?|vx|v信|wx|加我vx|加vx|加v)[:：\s]*([a-z][a-z0-9_-]{5,19})/gi
  while ((match = wxRe.exec(source)) !== null) wechats.push(match[1].toLowerCase())

  const emails = []
  const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
  while ((match = emailRe.exec(source)) !== null) emails.push(match[0].toLowerCase())

  const urls = []
  const urlRe = /(?:https?:\/\/|www\.)[^\s]+|(?:[a-z0-9-]+\.)+(?:com|cn|net|org|cc|xyz)(?:\/[^\s]*)?/gi
  while ((match = urlRe.exec(source)) !== null) urls.push(match[0].toLowerCase())

  const amounts = []
  const amountRe = /(?:\d+(?:\.\d+)?)(?:\s*)(?:元|块|米|rmb|刀|块钱)/gi
  while ((match = amountRe.exec(source)) !== null) amounts.push(match[0].replace(/\s+/g, ''))
  const compactAmount = compact.match(/\d+(?:元|块|米|rmb|刀)/g) || []
  amounts.push(...compactAmount)

  const times = []
  const timeRe = /(?:今晚|明早|明天|后天|周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}[:：点]\d{0,2}|第[一二三四五六七八九十\d]+节)/g
  while ((match = timeRe.exec(source)) !== null) times.push(match[0])

  const qrHints = []
  if (/二维码|扫码加|扫一扫/.test(source) || /二维码|扫码加|扫一扫/.test(compact)) {
    qrHints.push('qr_text')
  }

  const contactIntent = /私我|联系我|加我vx|加v|加微信|私聊/.test(source) || /私我|联系我|加我vx|加v|加微信|私聊/.test(compact)

  return {
    phones: uniq(phones),
    qqs: uniq(qqs),
    wechats: uniq(wechats),
    emails: uniq(emails),
    urls: uniq(urls),
    amounts: uniq(amounts),
    times: uniq(times),
    qrHints: uniq(qrHints),
    contactIntent
  }
}

function hasActualContact(entities, imageFlags = {}) {
  return !!(
    (entities.phones && entities.phones.length) ||
    (entities.qqs && entities.qqs.length) ||
    (entities.wechats && entities.wechats.length) ||
    (entities.qrHints && entities.qrHints.length) ||
    imageFlags.qr ||
    imageFlags.contactInImage
  )
}

function normalizeTerm(term) {
  return normalizeText(term).normalizedText
}

function containsTerm(normalizedText, term) {
  const needle = normalizeTerm(term)
  if (!needle) return false
  if (REQUEST_SINGLE.includes(term)) {
    if (!normalizedText.includes(needle)) return false
    return !REQUEST_COMPOUND_BLOCK.some((block) => normalizedText.includes(normalizeTerm(block)))
  }
  if (/^[a-z0-9]{1,3}$/.test(needle)) {
    const re = new RegExp(`(^|[^a-z])${needle}([^a-z]|$)`)
    return re.test(normalizedText)
  }
  return normalizedText.includes(needle)
}

function matchLexicons(normalizedText, lexicons) {
  const hits = {}
  Object.keys(DEFAULT_LEXICONS).forEach((signal) => {
    const terms = (lexicons && lexicons[signal]) || DEFAULT_LEXICONS[signal] || []
    const seen = new Set()
    hits[signal] = []
    terms.forEach((term) => {
      const needle = normalizeTerm(term)
      if (!needle || seen.has(needle) || !containsTerm(normalizedText, term)) return
      seen.add(needle)
      hits[signal].push(term)
    })
  })
  return hits
}

function hasSignal(hits, name) {
  return !!(hits[name] && hits[name].length)
}

function channelAllowsContact(_channel) {
  // 全部分类都允许选填微信号（写到专用字段，不要写进正文）
  return true
}

function evaluateRules({ hits, entities, imageFlags, channel, contentType }) {
  const matched = []
  const actualContact = hasActualContact(entities, imageFlags)
  const contactIntent = !!(entities.contactIntent || hasSignal(hits, 'contact_intent'))
  const academicCore = hasSignal(hits, 'academic_core')
  const academicVariant = hasSignal(hits, 'academic_variant')
  const requestHit = hasSignal(hits, 'request_intent')
  const discussion = hasSignal(hits, 'discussion')
  const provider = hasSignal(hits, 'provider_intent')
  const transaction = hasSignal(hits, 'transaction') || (entities.amounts && entities.amounts.length > 0)
  const courseTime = hasSignal(hits, 'course_time') || (entities.times && entities.times.length > 0)

  if (academicCore && (requestHit || provider || transaction) && !discussion) {
    matched.push({ id: 'A01', outcome: OUTCOMES.REJECT, message: '涉及学业违规交易，无法发布' })
  }
  if (academicCore && !requestHit && !provider && !transaction && !discussion) {
    matched.push({ id: 'A02', outcome: OUTCOMES.MANUAL_REVIEW, message: '内容需人工复核，通过后才会公开' })
  }
  // 私信已下线，正文和评论允许直接留联系方式；联系方式只作为诈骗/曝光类规则的加重信号
  if (academicVariant && !academicCore) {
    matched.push({ id: 'A03', outcome: OUTCOMES.PASS, message: '' })
  }
  if (discussion && !transaction && !actualContact) {
    matched.push({ id: 'A05', outcome: OUTCOMES.PASS, message: '' })
  }
  if (hasSignal(hits, 'fraud_core')) {
    matched.push({ id: 'F01', outcome: OUTCOMES.MANUAL_REVIEW, message: '疑似诈骗引流，已隐藏并转人工审核', priority: 'high' })
  }
  if (hasSignal(hits, 'fraud_recruit')) {
    const recruitHits = hits.fraud_recruit || []
    const strongRecruit = recruitHits.some((word) => (
      ['日赚', '稳赚', '躺赚', '稳赚不赔', '0投资', '无需本金', '兼职刷', '兼职点赞'].includes(word)
    ))
    if (strongRecruit || recruitHits.length >= 2 || transaction || actualContact || contactIntent || requestHit || provider) {
      matched.push({ id: 'F02', outcome: OUTCOMES.MANUAL_REVIEW, message: '疑似诈骗兼职引流，已隐藏并转人工审核', priority: 'high' })
    }
  }
  if (hasSignal(hits, 'fraud_lend') || hasSignal(hits, 'rebate_promo')) {
    matched.push({ id: 'F03', outcome: OUTCOMES.MANUAL_REVIEW, message: '疑似借贷/返利引流，已隐藏并转人工审核', priority: 'high' })
  }
  if (hasSignal(hits, 'gambling_core')) {
    matched.push({ id: 'F04', outcome: OUTCOMES.MANUAL_REVIEW, message: '疑似博彩相关内容，已隐藏并转人工审核', priority: 'high' })
  }
  if (hasSignal(hits, 'doxx_intent') && (actualContact || hasSignal(hits, 'privacy_target') || hasSignal(hits, 'voyeur_privacy'))) {
    matched.push({ id: 'P01', outcome: OUTCOMES.MANUAL_REVIEW, message: '疑似曝光他人隐私，已隐藏并转人工审核', priority: 'high' })
  }
  if (hasSignal(hits, 'voyeur_privacy')) {
    matched.push({ id: 'P02', outcome: OUTCOMES.MANUAL_REVIEW, message: '疑似偷拍或隐私曝光，已隐藏并转人工审核', priority: 'high' })
  }
  if (hasSignal(hits, 'serious_accusation')) {
    matched.push({
      id: 'N01',
      outcome: OUTCOMES.MANUAL_REVIEW,
      message: '重大指控需人工审核',
      priority: hasSignal(hits, 'rumor_marker') ? 'high' : 'normal'
    })
  }
  if (hasSignal(hits, 'official_impersonate')) {
    matched.push({
      id: 'S01',
      outcome: OUTCOMES.MANUAL_REVIEW,
      message: '疑似冒充官方通知，已隐藏并转人工审核',
      priority: 'high'
    })
  }
  if (hasSignal(hits, 'violence_call') && !hasSignal(hits, 'help_seek')) {
    matched.push({
      id: 'E01',
      outcome: OUTCOMES.MANUAL_REVIEW,
      message: '疑似暴力或行动号召，已隐藏并转人工审核',
      priority: 'high',
      notifyOwner: true
    })
  }
  if (hasSignal(hits, 'hate_core')) {
    matched.push({
      id: 'H01',
      outcome: OUTCOMES.MANUAL_REVIEW,
      message: '疑似极端仇恨内容，已隐藏并转人工审核',
      priority: 'high'
    })
  }

  const politicsContext = hasSignal(hits, 'politics_context')
  const politicsEntity = hasSignal(hits, 'politics_entity')
  if (hasSignal(hits, 'politics_highrisk')) {
    matched.push({
      id: 'G01',
      outcome: OUTCOMES.MANUAL_REVIEW,
      message: '内容涉及高风险信息，已隐藏并转人工审核',
      priority: 'high'
    })
  }
  if (politicsEntity && hasSignal(hits, 'politics_attack') && !politicsContext) {
    matched.push({
      id: 'G02',
      outcome: OUTCOMES.MANUAL_REVIEW,
      message: '内容涉及高风险信息，已隐藏并转人工审核',
      priority: 'high'
    })
  }
  if (politicsEntity && !politicsContext && (hasSignal(hits, 'rumor_marker') || hasSignal(hits, 'serious_accusation'))) {
    matched.push({
      id: 'G03',
      outcome: OUTCOMES.MANUAL_REVIEW,
      message: '内容需人工复核，通过后才会公开',
      priority: 'high'
    })
  }

  if (hasSignal(hits, 'adult_core')) {
    matched.push({
      id: 'X01',
      outcome: OUTCOMES.MANUAL_REVIEW,
      message: '疑似色情低俗内容，已隐藏并转人工审核',
      priority: 'high'
    })
  }
  if (hasSignal(hits, 'dating_solicit')) {
    matched.push({
      id: 'X02',
      outcome: OUTCOMES.MANUAL_REVIEW,
      message: '疑似约会社交引流，已隐藏并转人工审核',
      priority: 'high'
    })
  }
  if (hasSignal(hits, 'adult_hint')) {
    matched.push({
      id: 'X03',
      outcome: OUTCOMES.MANUAL_REVIEW,
      message: '内容疑似低俗擦边，已隐藏并转人工审核'
    })
  }
  if (hasSignal(hits, 'abuse_core')) {
    matched.push({
      id: 'I01',
      outcome: OUTCOMES.MANUAL_REVIEW,
      message: '疑似严重辱骂或人身攻击，已隐藏并转人工审核',
      priority: 'high'
    })
  }

  // 营销广告图：自动隐藏进人工审；二维码图片放行（私信下线，同学靠二维码加好友）
  if (imageFlags.marketingAd || imageFlags.ad) {
    matched.push({
      id: 'D01',
      outcome: OUTCOMES.MANUAL_REVIEW,
      message: '图片疑似营销广告，已隐藏并转人工审核',
      priority: 'high'
    })
  }

  return matched
}

function vendorHoldRule(vendor) {
  if (!vendor || (!vendor.highRisk && !vendor.uncertain)) return null
  // 同步图片接口只有通过/不通过，正常照片误报很多，不单凭它隐藏
  if (String(vendor.source || '').includes('imgSecCheck')) return null
  const label = Number(vendor.label || 0)
  const serious = label === 20001 || label === 20002 || label === 20006 || label === 20008
  if (vendor.uncertain && !serious) return null
  if (vendor.highRisk && !serious && label !== 21000) return null
  return {
    id: serious ? `V01_${label}` : (vendor.uncertain ? 'V02' : 'V01'),
    outcome: OUTCOMES.MANUAL_REVIEW,
    message: vendor.message || '未通过云端安全审核，已隐藏并转人工审核',
    priority: serious ? 'high' : 'normal'
  }
}

function mergeOutcomes(matched, vendor = {}) {
  const vendorRules = []
  const hold = vendorHoldRule(vendor)
  if (hold) vendorRules.push(hold)
  const all = vendorRules.concat(matched || [])
  if (!all.length) {
    return {
      outcome: OUTCOMES.PASS,
      reviewStatus: OUTCOMES.PASS,
      ruleIds: [],
      message: '',
      tip: '',
      priority: 'normal',
      restrictAccount: false,
      notifyOwner: false
    }
  }
  const ranked = all.slice().sort((a, b) => (SEVERITY[b.outcome] || 0) - (SEVERITY[a.outcome] || 0))
  const top = ranked[0]
  return {
    outcome: top.outcome,
    reviewStatus: top.outcome,
    ruleIds: uniq(all.map((item) => item.id)),
    message: top.message || '',
    tip: ranked.map((item) => item.tip).find(Boolean) || '',
    priority: ranked.some((item) => item.priority === 'high') ? 'high' : (top.priority || 'normal'),
    restrictAccount: all.some((item) => item.restrictAccount),
    notifyOwner: all.some((item) => item.notifyOwner),
    matched: all
  }
}

function lexiconMapFromRows(rows) {
  const map = {}
  const disabled = new Set()
  SIGNAL_TYPES.forEach((item) => { map[item.id] = [] })
  ;(rows || []).forEach((row) => {
    if (!row) return
    const signal = row.signal
    const word = String(row.word || '').trim()
    if (!signal || !word) return
    if (row.enabled === false) {
      disabled.add(`${signal}::${word}`)
      return
    }
    if (!map[signal]) map[signal] = []
    map[signal].push(word)
  })
  Object.keys(DEFAULT_LEXICONS).forEach((signal) => {
    if (!map[signal]) map[signal] = []
    const seen = new Set(map[signal].map((word) => normalizeTerm(word)))
    DEFAULT_LEXICONS[signal].forEach((word) => {
      if (disabled.has(`${signal}::${word}`)) return
      const needle = normalizeTerm(word)
      if (!needle || seen.has(needle)) return
      seen.add(needle)
      map[signal].push(word)
    })
  })
  return map
}

function seedLexiconRows(now = Date.now()) {
  const rows = []
  Object.keys(DEFAULT_LEXICONS).forEach((signal) => {
    DEFAULT_LEXICONS[signal].forEach((word) => {
      rows.push({
        id: `${signal}::${word}`,
        signal,
        word,
        enabled: true,
        locked: true,
        version: 1,
        createdAt: now,
        updatedAt: now
      })
    })
  })
  return rows
}

function reviewText(input = {}, options = {}) {
  const originalText = [
    input.title,
    input.content,
    input.extra,
    input.routeFrom,
    input.routeTo,
    input.departTime,
    input.nickname,
    input.contactValue
  ].filter(Boolean).join('\n')
  const prepared = normalizeText(originalText)
  const entities = extractEntities(originalText, prepared)
  const lexicons = options.lexicons || DEFAULT_LEXICONS
  const hits = matchLexicons(prepared.normalizedText, lexicons)
  if (REQUEST_SINGLE.some((term) => containsTerm(prepared.normalizedText, term))) {
    hits.request_intent = uniq((hits.request_intent || []).concat(['求']))
  }
  const vendor = options.vendor || {}
  const matched = evaluateRules({
    hits,
    entities,
    imageFlags: input.imageFlags || {},
    channel: input.channel || input.tag || input.category || '',
    contentType: input.contentType || 'post'
  })
  // 接口超时或不可用时沿用本地词库结果，不再一律隐藏
  const merged = mergeOutcomes(matched, (vendor.timeout || vendor.degraded) ? {} : vendor)
  return finalize(prepared, entities, hits, merged, vendor)
}

function finalize(prepared, entities, hits, merged, vendor) {
  const passed = merged.outcome === OUTCOMES.PASS
  const publicVisible = passed
  return {
    passed,
    publicVisible,
    outcome: merged.outcome,
    reviewStatus: merged.reviewStatus,
    message: merged.message || userMessage(merged.outcome),
    tip: merged.tip || '',
    ruleIds: merged.ruleIds || [],
    priority: merged.priority || 'normal',
    restrictAccount: !!merged.restrictAccount,
    notifyOwner: !!merged.notifyOwner,
    originalText: prepared.originalText,
    normalizedText: prepared.normalizedText,
    signals: hits,
    entities,
    vendor: vendor.skipped ? { skipped: true } : vendor,
    matched: merged.matched || [],
    note: reviewNote(merged)
  }
}

function userMessage(outcome) {
  if (outcome === OUTCOMES.PASS) return ''
  if (outcome === OUTCOMES.EDIT_REQUIRED) return '请按提示修改后再发布'
  if (outcome === OUTCOMES.MANUAL_REVIEW) return '已提交，人工审核通过后才会公开'
  if (outcome === OUTCOMES.REJECT) return '内容未通过审核，请修改后重试'
  if (outcome === OUTCOMES.EMERGENCY_BLOCK) return '内容已紧急拦截'
  if (outcome === OUTCOMES.PENDING) return '审核处理中，通过后才会公开'
  return '内容未通过审核'
}

function reviewNote(merged) {
  if (merged.outcome === OUTCOMES.PASS) return ''
  const rules = (merged.ruleIds || []).join('、')
  return [merged.message || userMessage(merged.outcome), rules ? `规则 ${rules}` : ''].filter(Boolean).join(' · ')
}

function reviewStatusLabel(status) {
  return {
    approved: '已通过',
    pending: '审核中',
    manual_review: '人工审核',
    edit_required: '需修改',
    rejected: '未通过',
    emergency_block: '紧急拦截'
  }[status] || status || ''
}

function isPublicStatus(status) {
  return status === OUTCOMES.PASS || status === 'approved'
}

function isOwnerVisibleStatus(status) {
  return !!status
}

function countsAsViolation(outcome) {
  return outcome === OUTCOMES.REJECT || outcome === OUTCOMES.EMERGENCY_BLOCK
}

function needsWallContact(_tag) {
  return true
}

function validateWallContact(type, value, _tag) {
  const text = String(value || '').trim()
  // 选填：空着可以通过
  if (!text) return { ok: true, contactType: '', contactValue: '' }
  if (text.length < 2 || text.length > 30 || /\s/.test(text)) {
    return { ok: false, message: '请填写有效微信号' }
  }
  return { ok: true, contactType: 'wechat', contactValue: text }
}

module.exports = {
  OUTCOMES,
  SEVERITY,
  SIGNAL_TYPES,
  DEFAULT_LEXICONS,
  CONTACT_ALLOWED_CHANNELS,
  normalizeText,
  extractEntities,
  matchLexicons,
  reviewText,
  lexiconMapFromRows,
  seedLexiconRows,
  reviewStatusLabel,
  isPublicStatus,
  isOwnerVisibleStatus,
  countsAsViolation,
  channelAllowsContact,
  needsWallContact,
  validateWallContact,
  hasActualContact
}
