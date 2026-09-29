const fs = require('fs')
const path = require('path')
const moderation = require('../../utils/moderation')
const security = require('../../utils/security')

const DATA_DIR = path.join(__dirname, '..', 'data')
const DATA_FILE = path.join(DATA_DIR, 'local-store.json')

function emptyStore() {
  return {
    users: [],
    forum_posts: [],
    wall_posts: [],
    comments: [],
    school_requests: [],
    keywords: [],
    lexicon_terms: [],
    security_logs: [],
    contact_views: [],
    contact_feedbacks: [],
    digest_queue: [],
    digests: [],
    weekly_hot: [],
    distribute_targets: [],
    distribute_logs: [],
    meta: []
  }
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function readStore() {
  ensureDir()
  if (!fs.existsSync(DATA_FILE)) {
    const seeded = seedStore()
    writeStore(seeded)
    return seeded
  }
  try {
    return { ...emptyStore(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }
  } catch (err) {
    const seeded = seedStore()
    writeStore(seeded)
    return seeded
  }
}

function writeStore(store) {
  ensureDir()
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8')
}

function collection(store, name) {
  if (!store[name]) store[name] = []
  return store[name]
}

function seedStore() {
  const now = Date.now()
  const store = emptyStore()
  store.lexicon_terms = moderation.seedLexiconRows(now)
  store.meta = [{ id: 'lexicon', version: 1, updatedAt: now }]
  store.keywords = security.DEFAULT_KEYWORDS.map((word) => ({
    word,
    locked: security.isLockedKeyword(word),
    createdAt: now
  }))
  store.distribute_targets = [{
    id: 'g_customer',
    name: '群聊推送测试',
    type: 'external',
    enabled: true,
    chatId: '',
    sender: '',
    receiveDigest: true,
    scopes: ['wall'],
    boards: ['*'],
    desc: '本地演示群'
  }]
  store.users = [
    {
      id: 'u_admin_demo',
      nickname: '晚风吹过操场',
      avatar: '/images/avatar-1.png',
      schoolName: '武汉大学',
      schoolCampus: '文理学部',
      schoolLocked: true,
      status: 'active',
      riskScore: 20,
      violateCount: 1,
      createdAt: now - 86400000
    },
    {
      id: 'u_risk_demo',
      nickname: '图书馆三楼靠窗',
      avatar: '/images/avatar-2.png',
      schoolName: '武汉大学',
      schoolCampus: '信息学部',
      schoolLocked: true,
      status: 'active',
      riskScore: 40,
      violateCount: 2,
      createdAt: now - 43200000
    }
  ]

  const samples = [
    {
      collection: 'forum_posts',
      item: {
        id: 'f_review_1',
        category: '吐槽树洞',
        title: '明早高数代课',
        content: '明早高数代课，有没有一起的',
        images: [],
        authorId: 'u_risk_demo',
        authorName: '图书馆三楼靠窗',
        authorAvatar: '/images/avatar-2.png',
        authorSchool: '武汉大学 · 信息学部',
        anonymous: false,
        reviewStatus: 'manual_review',
        reviewOutcome: 'manual_review',
        reviewNote: '内容需人工复核，通过后才会公开 · 规则 A02',
        reviewRuleIds: ['A02'],
        reviewPriority: 'normal',
        originalText: '明早高数代课\n明早高数代课，有没有一起的',
        normalizedText: '明早高数代课明早高数代课有没有一起的',
        reviewSignals: { academic_core: ['代课'], course_time: ['高数', '明早'] },
        matchedKeywords: ['代课', '高数', '明早'],
        createdAt: now - 3600000,
        likeCount: 0,
        commentCount: 0,
        viewCount: 3
      }
    },
    {
      collection: 'wall_posts',
      item: {
        id: 'w_review_1',
        tag: '出行拼车',
        title: '',
        routeFrom: '信息学部',
        routeTo: '汉口火车站',
        departTime: '周五 16:00',
        extra: '还可坐 2 人',
        content: '明早高数DK，加我vx：abc123',
        images: [],
        contactType: 'wechat',
        contactValue: 'campus_ride',
        authorId: 'u_admin_demo',
        authorName: '晚风吹过操场',
        authorAvatar: '/images/avatar-1.png',
        authorSchool: '武汉大学 · 文理学部',
        anonymous: false,
        dealStatus: 'open',
        reviewStatus: 'edit_required',
        reviewOutcome: 'edit_required',
        reviewNote: '请勿在正文留微信号/手机号/二维码，请改填到专用联系方式字段 · 规则 A04、C02',
        reviewRuleIds: ['A04', 'C02'],
        reviewPriority: 'normal',
        originalText: '明早高数DK，加我vx：abc123',
        normalizedText: '明早高数dk加我vxabc123',
        reviewSignals: { academic_variant: ['dk'], contact_intent: ['加我vx'], course_time: ['高数', '明早'] },
        matchedKeywords: ['dk', '加我vx', '高数', '明早'],
        createdAt: now - 1800000,
        likeCount: 0,
        commentCount: 0,
        viewCount: 1
      }
    },
    {
      collection: 'forum_posts',
      item: {
        id: 'f_review_2',
        category: '校园生活',
        title: '听说食堂发生集体中毒',
        content: '听说食堂发生集体中毒，有人知道真假吗',
        images: [],
        authorId: 'u_risk_demo',
        authorName: '图书馆三楼靠窗',
        authorAvatar: '/images/avatar-2.png',
        authorSchool: '武汉大学 · 信息学部',
        anonymous: false,
        reviewStatus: 'manual_review',
        reviewOutcome: 'manual_review',
        reviewNote: '重大指控需人工审核 · 规则 N01',
        reviewRuleIds: ['N01'],
        reviewPriority: 'high',
        originalText: '听说食堂发生集体中毒\n听说食堂发生集体中毒，有人知道真假吗',
        normalizedText: '听说食堂发生集体中毒听说食堂发生集体中毒有人知道真假吗',
        reviewSignals: { serious_accusation: ['集体中毒'], rumor_marker: ['听说'] },
        matchedKeywords: ['集体中毒', '听说'],
        createdAt: now - 900000,
        likeCount: 0,
        commentCount: 0,
        viewCount: 8
      }
    },
    {
      collection: 'wall_posts',
      item: {
        id: 'w_review_2',
        tag: '二手闲置流转',
        title: '几乎全新的台灯',
        price: '35 元',
        content: '宿舍不用了，西区面交',
        images: [],
        contactType: 'wechat',
        contactValue: 'lamp_trade',
        authorId: 'u_admin_demo',
        authorName: '晚风吹过操场',
        authorAvatar: '/images/avatar-1.png',
        authorSchool: '武汉大学 · 文理学部',
        anonymous: false,
        dealStatus: 'open',
        reviewStatus: 'approved',
        reviewNote: '',
        reviewRuleIds: [],
        createdAt: now - 7200000,
        likeCount: 4,
        commentCount: 1,
        viewCount: 36
      }
    },
    {
      collection: 'forum_posts',
      item: {
        id: 'f_review_3',
        category: '吐槽树洞',
        title: '今晚去某地堵他',
        content: '今晚去某地堵他，谁来一起',
        images: [],
        authorId: 'u_risk_demo',
        authorName: '图书馆三楼靠窗',
        authorAvatar: '/images/avatar-2.png',
        anonymous: true,
        reviewStatus: 'emergency_block',
        reviewOutcome: 'emergency_block',
        reviewNote: '内容已紧急拦截，等待处理 · 规则 E01',
        reviewRuleIds: ['E01'],
        reviewPriority: 'high',
        notifyOwner: true,
        originalText: '今晚去某地堵他\n今晚去某地堵他，谁来一起',
        normalizedText: '今晚去某地堵他今晚去某地堵他谁来一起',
        reviewSignals: { violence_call: ['堵他'], course_time: ['今晚'] },
        matchedKeywords: ['堵他', '今晚'],
        createdAt: now - 600000,
        likeCount: 0,
        commentCount: 0,
        viewCount: 0
      }
    }
  ]

  samples.forEach(({ collection: name, item }) => {
    collection(store, name).push(item)
  })

  store.comments = [{
    id: 'c_review_1',
    targetType: 'forum',
    targetId: 'f_review_1',
    content: '谁能帮我代课？',
    images: [],
    authorId: 'u_risk_demo',
    authorName: '图书馆三楼靠窗',
    authorAvatar: '/images/avatar-2.png',
    reviewStatus: 'rejected',
    reviewNote: '涉及学业违规交易，无法发布 · 规则 A01',
    reviewRuleIds: ['A01'],
    createdAt: now - 3000000
  }]

  store.security_logs = [{
    id: 'sl_demo_1',
    level: 'critical',
    type: 'emergency_block',
    userId: 'u_risk_demo',
    userNickname: '图书馆三楼靠窗',
    detail: '学习分享发帖：内容已紧急拦截，等待处理（E01）',
    ruleIds: ['E01'],
    notifyOwner: true,
    createdAt: now - 600000
  }]

  store.school_requests = []
  store.weekly_hot = [{
    id: 'current',
    title: '每周精选',
    subtitle: '管理员精选热榜',
    enabled: true,
    items: [],
    updatedAt: now
  }]
  return store
}

async function allDocs(name, where) {
  const store = readStore()
  let list = collection(store, name).slice()
  if (where && typeof where === 'object') {
    list = list.filter((item) => Object.keys(where).every((key) => item[key] === where[key]))
  }
  return list
}

async function getDoc(name, id) {
  const store = readStore()
  return collection(store, name).find((item) => item.id === id || item._id === id || item.word === id) || null
}

async function setDoc(name, id, data) {
  const store = readStore()
  const list = collection(store, name)
  const next = { ...data, id }
  const index = list.findIndex((item) => item.id === id || item._id === id || item.word === id)
  if (index >= 0) list[index] = next
  else list.unshift(next)
  writeStore(store)
  return next
}

async function updateDoc(name, id, data) {
  const store = readStore()
  const list = collection(store, name)
  const index = list.findIndex((item) => item.id === id || item._id === id || item.word === id)
  if (index < 0) throw new Error('文档不存在')
  list[index] = { ...list[index], ...data, id: list[index].id || id }
  writeStore(store)
  return list[index]
}

async function removeDoc(name, id) {
  const store = readStore()
  const list = collection(store, name)
  store[name] = list.filter((item) => item.id !== id && item._id !== id && item.word !== id)
  writeStore(store)
}

function resetLocal() {
  const seeded = seedStore()
  writeStore(seeded)
  return seeded
}

function isLocalMode() {
  if (process.env.ADMIN_LOCAL === '1' || process.env.ADMIN_LOCAL === 'true') return true
  return !(process.env.TCB_ENV && process.env.TCB_SECRET_ID && process.env.TCB_SECRET_KEY)
}

module.exports = {
  allDocs,
  getDoc,
  setDoc,
  updateDoc,
  removeDoc,
  resetLocal,
  isLocalMode,
  DATA_FILE
}
