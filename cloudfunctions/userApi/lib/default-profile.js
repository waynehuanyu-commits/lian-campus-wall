const DEFAULT_AVATARS = [
  '/images/default-avatars/avatar-01.jpg',
  '/images/default-avatars/avatar-02.jpg',
  '/images/default-avatars/avatar-03.jpg',
  '/images/default-avatars/avatar-04.jpg',
  '/images/default-avatars/avatar-05.jpg',
  '/images/default-avatars/avatar-06.jpg',
  '/images/default-avatars/avatar-07.jpg',
  '/images/default-avatars/avatar-08.jpg',
  '/images/default-avatars/avatar-09.jpg',
  '/images/default-avatars/avatar-10.jpg',
  '/images/default-avatars/avatar-11.jpg',
  '/images/default-avatars/avatar-12.jpg',
  '/images/default-avatars/avatar-13.jpg',
  '/images/default-avatars/avatar-14.jpg',
  '/images/default-avatars/avatar-15.jpg',
  '/images/default-avatars/avatar-16.jpg',
  '/images/default-avatars/avatar-17.jpg',
  '/images/default-avatars/avatar-18.jpg',
  '/images/default-avatars/avatar-19.jpg',
  '/images/default-avatars/avatar-20.jpg',
  '/images/default-avatars/avatar-21.jpg',
  '/images/default-avatars/avatar-22.jpg',
  '/images/default-avatars/avatar-23.jpg',
  '/images/default-avatars/avatar-24.jpg',
  '/images/default-avatars/avatar-25.jpg',
  '/images/default-avatars/avatar-26.jpg',
  '/images/default-avatars/avatar-27.jpg',
  '/images/default-avatars/avatar-28.jpg',
  '/images/default-avatars/avatar-29.jpg',
  '/images/default-avatars/avatar-30.jpg',
  '/images/default-avatars/avatar-31.jpg',
  '/images/default-avatars/avatar-32.jpg',
  '/images/default-avatars/avatar-33.jpg',
  '/images/default-avatars/avatar-34.jpg',
  '/images/default-avatars/avatar-35.jpg',
  '/images/default-avatars/avatar-36.jpg',
  '/images/default-avatars/avatar-37.jpg',
  '/images/default-avatars/avatar-38.jpg',
  '/images/default-avatars/avatar-39.jpg',
  '/images/default-avatars/avatar-40.jpg',
  '/images/default-avatars/avatar-41.jpg',
  '/images/default-avatars/avatar-42.jpg',
  '/images/default-avatars/avatar-43.jpg',
  '/images/default-avatars/avatar-44.jpg',
  '/images/default-avatars/avatar-45.jpg',
  '/images/default-avatars/avatar-46.jpg',
  '/images/default-avatars/avatar-47.jpg',
  '/images/default-avatars/avatar-48.jpg',
  '/images/default-avatars/avatar-49.jpg',
  '/images/default-avatars/avatar-50.jpg'
]

const LEGACY_NICKNAMES = new Set(['', '黎安话事', '同学', '黎安人'])
const ANONYMOUS_NICKNAMES = new Set(['匿名', '匿名同学', '匿名用户', '匿名树洞'])
const LEGACY_AVATAR = '/images/avatar-default.png'
const DEFAULT_AVATAR_SET = new Set(DEFAULT_AVATARS)

function randomAvatar() {
  return DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)]
}

function hashSeed(seed) {
  const text = String(seed || 'lian')
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  }
  return hash
}

function randomNickname() {
  const n = Math.floor(Math.random() * 1000)
  return `黎安人${String(n).padStart(3, '0')}`
}

function stableNickname(seed) {
  return `黎安人${String(hashSeed(seed) % 1000).padStart(3, '0')}`
}

function isLegacyNickname(name) {
  return LEGACY_NICKNAMES.has(String(name || '').trim())
}

function isAnonymousNickname(name) {
  return ANONYMOUS_NICKNAMES.has(String(name || '').trim())
}

/** 账号上的旧默认名、旧匿名名换成稳定的「黎安人xxx」，自定义昵称保留 */
function resolveProfileNickname(name, seed) {
  const text = String(name || '').trim()
  if (isLegacyNickname(text) || isAnonymousNickname(text)) return stableNickname(seed)
  return text || stableNickname(seed)
}

// 分身昵称：形容词 + 名词，按种子稳定生成；同一种子永远是同一个名字
const ALIAS_ADJECTIVES = [
  '安静的', '路过的', '早起的', '熬夜的', '认真的', '迷糊的', '快乐的', '温柔的',
  '勇敢的', '慢吞吞的', '爱笑的', '发呆的', '好奇的', '靠谱的', '神秘的', '元气的',
  '佛系的', '努力的', '爱吃的', '散步的', '晒太阳的', '追风的', '淡定的', '话少的',
  '热心的', '刚下课的', '不想早八的', '想放假的', '在图书馆的', '在食堂的', '听歌的', '看书的'
]
const ALIAS_NOUNS = [
  '柚子', '银杏', '橘猫', '海盐', '松果', '小熊', '芒果', '企鹅',
  '月亮', '星星', '薄荷', '桃子', '奶茶', '鲸鱼', '蘑菇', '饺子',
  '仙人掌', '向日葵', '小鹿', '豆浆', '云朵', '刺猬', '柠檬', '包子',
  '海豚', '兔子', '樱桃', '土豆', '橙子', '麻雀', '松鼠', '西瓜'
]

/** 分身昵称：种子由云端用不可逆哈希生成，前端只在旧数据缺名字时用帖子/评论 id 兜底 */
function aliasNickname(seed) {
  const hash = hashSeed(`alias:${seed}`)
  return ALIAS_ADJECTIVES[hash % ALIAS_ADJECTIVES.length]
    + ALIAS_NOUNS[Math.floor(hash / ALIAS_ADJECTIVES.length) % ALIAS_NOUNS.length]
}

/** 帖子/评论展示名：分身用存下的分身昵称（旧「匿名同学」按 id 换成分身昵称），旧默认名按作者换成「黎安人xxx」 */
function resolveAuthorName(name, seed, options = {}) {
  const text = String(name || '').trim()
  const anonymous = !!(options && options.anonymous)
  if (isAnonymousNickname(text)) return aliasNickname(seed)
  if (anonymous) return text || aliasNickname(seed)
  if (isLegacyNickname(text)) return stableNickname(seed)
  return text || stableNickname(seed)
}

function isPackagedDefaultAvatar(avatar) {
  return DEFAULT_AVATAR_SET.has(String(avatar || '').trim())
}

/** 旧灰头像 / 空头像 / 历史本地占位图，一律替换成 50 张默认图之一 */
function isLegacyAvatar(avatar) {
  const text = String(avatar || '').trim()
  if (!text) return true
  if (isPackagedDefaultAvatar(text)) return false
  // 用户上传：云文件 / 远程图 / 本地临时文件
  if (/^(cloud:\/\/|https?:\/\/|wxfile:\/\/|http:\/\/tmp\/)/i.test(text)) return false
  if (text === LEGACY_AVATAR) return true
  if (/avatar-default\.(png|jpg|jpeg|webp)$/i.test(text)) return true
  // /images/avatar-1.png ~ avatar-5.png 以及无路径写法
  if (/\/images\/avatar-\d+\.(png|jpg|jpeg|webp)$/i.test(text)) return true
  if (/^avatar-\d+\.(png|jpg|jpeg|webp)$/i.test(text)) return true
  // 仅剩灰色底时常见空壳
  if (text === '/images/avatar.png' || text === 'avatar.png') return true
  return false
}

function isCustomAvatar(avatar) {
  const text = String(avatar || '').trim()
  if (!text || isLegacyAvatar(text) || isPackagedDefaultAvatar(text)) return false
  return true
}

function stableAvatar(seed) {
  return DEFAULT_AVATARS[hashSeed(seed) % DEFAULT_AVATARS.length]
}

/**
 * 上传图优先；已是 50 张默认之一则保留；否则按 seed 稳定映射到默认图。
 * 匿名帖请走 resolveAuthorAvatar(..., { anonymous: true }).
 */
function resolveAvatar(avatar, seed) {
  const text = String(avatar || '').trim()
  if (isPackagedDefaultAvatar(text)) return text
  if (isCustomAvatar(text)) return text
  return stableAvatar(seed)
}

/** 列表/详情统一入口：匿名或昵称「匿名同学」强制用默认图，不用库里旧地址 */
function resolveAuthorAvatar(avatar, seed, options = {}) {
  const anonymous = !!(options && options.anonymous)
  const name = String((options && options.authorName) || '').trim()
  if (anonymous || isAnonymousNickname(name)) return stableAvatar(seed)
  return resolveAvatar(avatar, seed)
}

function defaultProfilePatch(user) {
  if (!user || user.id === 'official_lian_wall' || user.id === 'guest_readonly') return null
  const patch = {}
  if (isLegacyNickname(user.nickname) || isAnonymousNickname(user.nickname)) {
    patch.nickname = stableNickname(user.id)
  }
  if (isLegacyAvatar(user.avatar)) patch.avatar = stableAvatar(user.id)
  return Object.keys(patch).length ? patch : null
}

module.exports = {
  DEFAULT_AVATARS,
  LEGACY_AVATAR,
  randomAvatar,
  randomNickname,
  stableNickname,
  isLegacyNickname,
  isAnonymousNickname,
  aliasNickname,
  resolveProfileNickname,
  resolveAuthorName,
  isLegacyAvatar,
  isCustomAvatar,
  isPackagedDefaultAvatar,
  stableAvatar,
  resolveAvatar,
  resolveAuthorAvatar,
  defaultProfilePatch
}
