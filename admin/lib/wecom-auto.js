// 企微自动推送（只在成都服务器的 liaan-admin 进程里跑，systemd 里设 WECOM_AUTO_SEND=1 才启动；
// 8788 那个手动进程不设，避免同一批推两次）。
//
// 链路：发帖 / 人工审核通过 → digest_queue（每帖一条 dq_<帖子id>，见 utils/home-feed.js digestQueueItem）
//      → 本模块每 2 分钟看一次，三种情况会推（都只在 08:00–00:30 之间，夜里攒的留到早上 8 点）：
//        1) 固定时段 08:00 / 12:10 / 13:50 / 17:20 / 20:00 / 22:30 / 00:30，有几条推几条
//        2) 两个时段之间攒够 8 条、且距上次推送满 1 小时，提前推
//        3) 有急事帖（push-risk.js isUrgent），10 分钟内推出去，急事推送之间至少隔 30 分钟
//        每次把可推的全部推完：每条群消息最多 8 帖，多了分几条连着发，编号连续，急事排前面标【急】
//      → 推送前按 push-risk.js 分级：风险内容不推；争议内容先发企微消息给确认人，确认后进下一轮
//      → 每个客户群由它的群主在企业微信里点「发送」才进群（企微对外部客户群的硬规定，只有群主能发）
//
// 为什么放在服务器而不是云函数：企微只认「企业可信IP」，成都服务器 118.24.61.135 已加白名单，云函数出口 IP 不固定。
// 配置在 server/.env：WECOM_CORP_ID / WECOM_SECRET / WECOM_AGENT_ID / WECOM_CHAT_ID（多群逗号分隔）/
// WECOM_CONFIRM_USERS / PUSH_CONFIRM_BASE / PUSH_CONFIRM_SECRET；小程序短链用 admin/.env 的 MINI_APPID / MINI_SECRET。

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const db = require('./db')
const { classifyForPush, isUrgent } = require('./push-risk')
const pushConfirm = require('./push-confirm')
const exposureFold = require('./exposure-fold')

const PER_MESSAGE = 8
// 北京时间的固定时段；00:30 算前一天晚上的最后一轮
const SLOTS = ['08:00', '12:10', '13:50', '17:20', '20:00', '22:30', '24:30']
// 00:30 那一轮留 10 分钟窗口（每 2 分钟才检查一次），00:40 起到 08:00 不推
const QUIET_START = 40
const QUIET_END = 8 * 60 // 08:00 之前
const VOLUME_TRIGGER = 8
const VOLUME_GAP_MS = 60 * 60 * 1000
const URGENT_GAP_MS = 30 * 60 * 1000
const MIN = 60 * 1000
const TICK_MS = 2 * 60 * 1000
const RETRY_PAUSE_MS = 30 * 60 * 1000
const STATE_ID = 'wecom_push_state'
const COVER_FILE = path.join(__dirname, '../../images/share-card.jpg')
const WECOM_HOST = 'https://qyapi.weixin.qq.com'
const WX_HOST = 'https://api.weixin.qq.com'

let running = false
let pausedUntil = 0
// 运行状态（只在跑推送的这个进程里有；后台「企微群发」页通过 getStatus 读）
const live = { started: false, startedAt: 0, lastTickAt: 0, lastTick: null, lastPush: null }
// 总开关存在 meta/wecom_push_control，后台可暂停 / 恢复；1 分钟内复用，少读库
const CONTROL_ID = 'wecom_push_control'
let controlCache = { enabled: true, at: 0 }
let coverCache = { id: '', at: 0 }
const ownerCache = new Map()

function uid(prefix) {
  return `${prefix}${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`
}

async function getJson(url) {
  return fetch(url).then((res) => res.json())
}

async function postJson(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then((res) => res.json())
}

async function wecomToken() {
  const data = await getJson(`${WECOM_HOST}/cgi-bin/gettoken?corpid=${process.env.WECOM_CORP_ID}&corpsecret=${process.env.WECOM_SECRET}`)
  if (data.errcode) throw new Error(`企微 token 失败：${data.errcode} ${data.errmsg}`)
  return data.access_token
}

// 去掉被截成半个的表情（孤立代理字符），否则企微整条报 40058
function cleanText(text) {
  return String(text || '').replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
}

function clip(text, max) {
  return Array.from(cleanText(text)).slice(0, max).join('')
}

/** 小程序卡片封面：企微临时素材 3 天有效，这里 2 天内复用同一个 */
async function coverMediaId(token) {
  if (coverCache.id && Date.now() - coverCache.at < 2 * 24 * 3600 * 1000) return coverCache.id
  if (!fs.existsSync(COVER_FILE)) return ''
  const form = new FormData()
  form.append('media', new Blob([fs.readFileSync(COVER_FILE)], { type: 'image/jpeg' }), 'cover.jpg')
  const data = await fetch(`${WECOM_HOST}/cgi-bin/media/upload?access_token=${token}&type=image`, {
    method: 'POST',
    body: form
  }).then((res) => res.json())
  if (data.errcode || !data.media_id) return ''
  coverCache = { id: data.media_id, at: Date.now() }
  return data.media_id
}

/** 每条帖子一个小程序短链（#小程序://…），学生在微信群里点了能直接打开；失败就不放链接 */
async function shortLinks(items) {
  if (!process.env.MINI_APPID || !process.env.MINI_SECRET) return {}
  try {
    const tk = await getJson(`${WX_HOST}/cgi-bin/token?grant_type=client_credential&appid=${process.env.MINI_APPID}&secret=${process.env.MINI_SECRET}`)
    if (!tk.access_token) return {}
    const out = {}
    for (const item of items) {
      const res = await postJson(`${WX_HOST}/wxa/genwxashortlink?access_token=${tk.access_token}`, {
        page_url: item.pagepath,
        page_title: clip(String(item.title || '查看').replace(/\s+/g, ''), 12) || '查看',
        is_permanent: false
      })
      if (res.link) out[item.contentId] = res.link
    }
    return out
  } catch (err) {
    return {}
  }
}

/** 群消息正文：只有编号列表，不加前后缀；编号在同一轮的两条消息里连续 */
function buildText(items, links, startIndex = 1) {
  return clip(items.map((item, index) => {
    const summary = item.summary && item.summary !== item.title && !item.summary.startsWith(item.title) ? `\n${clip(item.summary, 24)}` : ''
    const link = links[item.contentId] ? `\n${links[item.contentId]}` : ''
    return `${startIndex + index}. ${item.urgent ? '【急】' : ''}${cleanText(item.title)}${summary}${link}`
  }).join('\n\n'), 3900)
}

/** 要推的客户群：后台「推送目标」里启用的群，没有就用 WECOM_CHAT_ID（可逗号分隔多个） */
async function targetChatIds() {
  const groups = await db.allDocs('distribute_targets').catch(() => [])
  const ids = groups
    .filter((item) => item.enabled !== false && item.receiveDigest && item.chatId)
    .map((item) => item.chatId)
  if (ids.length) return ids
  return String(process.env.WECOM_CHAT_ID || '').split(',').map((s) => s.trim()).filter(Boolean)
}

/** 客户群群发的发送人必须是群主：按群查群主，同一个群主的群合成一条群发 */
async function groupsByOwner(token, chatIds) {
  const out = {}
  for (const chatId of chatIds) {
    let owner = ownerCache.get(chatId)
    if (!owner) {
      const res = await postJson(`${WECOM_HOST}/cgi-bin/externalcontact/groupchat/get?access_token=${token}`, { chat_id: chatId })
      owner = (res.group_chat && res.group_chat.owner) || ''
      if (owner) ownerCache.set(chatId, owner)
    }
    if (!owner) continue
    out[owner] = (out[owner] || []).concat(chatId)
  }
  return out
}

async function createGroupMessage(token, payload, digestId, title) {
  const url = `${WECOM_HOST}/cgi-bin/externalcontact/add_msg_template?access_token=${token}`
  const cover = await coverMediaId(token).catch(() => '')
  if (cover && process.env.MINI_APPID) {
    const withCard = await postJson(url, {
      ...payload,
      attachments: [{
        msgtype: 'miniprogram',
        miniprogram: {
          title: clip(title, 20),
          pic_media_id: cover,
          appid: process.env.MINI_APPID,
          page: `pages/digest/digest.html?id=${digestId}`
        }
      }]
    })
    if (!withCard.errcode) return { ...withCard, card: true }
    // 小程序没关联企微（90208）等原因发不了卡片，退回纯文字
    const textOnly = await postJson(url, payload)
    return { ...textOnly, card: false, cardError: `${withCard.errcode} ${withCard.errmsg}` }
  }
  return { ...(await postJson(url, payload)), card: false }
}

async function isEnabled(now = Date.now()) {
  if (now - controlCache.at < 60 * 1000) return controlCache.enabled
  const doc = await db.getDoc('meta', CONTROL_ID).catch(() => null)
  controlCache = { enabled: !doc || doc.enabled !== false, at: now }
  return controlCache.enabled
}

async function setEnabled(enabled, operator = '') {
  const doc = { id: CONTROL_ID, enabled: !!enabled, updatedAt: Date.now(), updatedBy: operator }
  await db.setDoc('meta', CONTROL_ID, doc)
  controlCache = { enabled: !!enabled, at: Date.now() }
  return doc
}

async function loadState() {
  return (await db.getDoc('meta', STATE_ID).catch(() => null)) || { lastPushAt: 0 }
}

/** 推送前分级：风险出队、争议等确认、可推的返回 */
async function sortQueue(token, queued) {
  const ready = []
  for (const item of queued) {
    if (item.confirm === 'approved' || item.pushChecked) { ready.push(item); continue }
    if (item.confirm === 'pending') continue
    if (item.confirm === 'rejected') { await db.removeDoc('digest_queue', item.id).catch(() => {}); continue }
    const post = await db.getDoc(item.contentType === 'wall' ? 'wall_posts' : 'forum_posts', item.contentId).catch(() => null)
    const verdict = classifyForPush(post)
    if (verdict.level === 'ok') {
      // 分级结果记在队列项上，之后每 2 分钟检查时不用再读帖子（省数据库请求）
      const checked = { ...item, pushChecked: true, urgent: isUrgent(post) }
      await db.setDoc('digest_queue', item.id, checked).catch(() => {})
      ready.push(checked)
      continue
    }
    if (verdict.level === 'risk') {
      await db.removeDoc('digest_queue', item.id).catch(() => {})
      await db.setDoc('distribute_logs', uid('dl_'), {
        contentType: 'push_skip', contentId: item.contentId, title: item.title,
        status: 'skipped_risk', reasons: verdict.reasons, createdAt: Date.now()
      }).catch(() => {})
      continue
    }
    const fullText = clip(`${(post && post.title) || ''}\n${(post && post.content) || ''}`.trim(), 600)
    const next = { ...item, confirm: 'pending', urgent: isUrgent(post), confirmReasons: verdict.reasons, fullText, notifiedAt: Date.now() }
    await db.setDoc('digest_queue', item.id, next)
    const sent = await pushConfirm.notifyConfirmers(token, next, verdict.reasons).catch((err) => ({ ok: false, error: err.message }))
    if (!sent.ok) console.warn(`[wecom-auto] 确认消息没发出：${sent.error}（这条留在队列，可到后台处理）`)
  }
  return ready
}

/** 真要推之前再看一眼帖子：入队后被删、被下架、被举报的不推，退回队列重新分级 */
async function recheckBeforePush(ready) {
  const out = []
  for (const item of ready) {
    if (item.confirm === 'approved') { out.push(item); continue }
    const post = await db.getDoc(item.contentType === 'wall' ? 'wall_posts' : 'forum_posts', item.contentId).catch(() => null)
    if (classifyForPush(post).level === 'ok') { out.push(item); continue }
    const { pushChecked, ...rest } = item
    await db.setDoc('digest_queue', item.id, rest).catch(() => {})
  }
  return out
}

function stripQueueFields(item) {
  const { _id, confirm, confirmReasons, fullText, notifiedAt, confirmedAt, confirmedLabel, pushChecked, ...rest } = item
  return rest
}

async function pushRound(token, ready) {
  // 全部推完，急事排前面
  const picked = ready.filter((item) => item.urgent).concat(ready.filter((item) => !item.urgent))
  const chatIds = await targetChatIds()
  if (!chatIds.length) throw new Error('没有绑定要推送的客户群（WECOM_CHAT_ID）')
  const owners = await groupsByOwner(token, chatIds)
  if (!Object.keys(owners).length) throw new Error('查不到客户群的群主')
  const links = await shortLinks(picked)
  const results = []
  for (let start = 0; start < picked.length; start += PER_MESSAGE) {
    const chunk = picked.slice(start, start + PER_MESSAGE)
    const items = chunk.map(stripQueueFields)
    const digest = {
      id: uid('dg_'),
      items,
      title: `黎安话事 · ${items.length} 条新帖`,
      summary: items.map((item, i) => `${start + i + 1}.${item.title}`).join(' ').slice(0, 120),
      source: 'wecom_auto',
      createdAt: Date.now()
    }
    digest.pagepath = `pages/digest/digest?id=${digest.id}`
    digest.sharePath = `/pages/digest/digest?id=${digest.id}`
    await db.setDoc('digests', digest.id, digest)
    const text = buildText(items, links, start + 1)
    const sends = []
    for (const [sender, ids] of Object.entries(owners)) {
      const payload = { chat_type: 'group', chat_id_list: ids, sender, text: { content: text } }
      sends.push({ sender, chatIds: ids, result: await createGroupMessage(token, payload, digest.id, digest.title) })
    }
    const ok = sends.some((s) => !s.result.errcode)
    await db.setDoc('digests', digest.id, { ...digest, wecomStatus: ok ? 'confirm' : 'failed', wecom: { sends } })
    await db.setDoc('distribute_logs', uid('dl_'), {
      groupType: 'external', contentType: 'digest', contentId: digest.id, title: digest.title,
      summary: digest.summary, items, itemCount: items.length,
      status: ok ? 'confirm' : 'failed', wecom: { sends }, createdAt: Date.now()
    })
    // 只有建成群发的才出队；失败的留在队列下次再推
    if (ok) await Promise.all(chunk.map((item) => db.removeDoc('digest_queue', item.id).catch(() => {})))
    results.push({ digest: digest.id, count: items.length, ok, sends })
  }
  return results
}

// 北京时间（服务器时区不一定是东八区）
function beijingMinutes(now) {
  const d = new Date(now + 8 * 3600 * 1000)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

function isQuiet(now) {
  const m = beijingMinutes(now)
  return m >= QUIET_START && m < QUIET_END
}

/** 最近一个已经到点的固定时段的时间戳（毫秒） */
function latestSlotAt(now) {
  const dayStart = Math.floor((now + 8 * 3600 * 1000) / (24 * 3600 * 1000)) * 24 * 3600 * 1000 - 8 * 3600 * 1000
  let latest = 0
  for (const offset of [0, -1]) {
    for (const slot of SLOTS) {
      const [h, m] = slot.split(':').map(Number)
      const at = dayStart + offset * 24 * 3600 * 1000 + (h * 60 + m) * MIN
      if (at <= now && at > latest) latest = at
    }
  }
  return latest
}

/** 这次该不该推、为什么；ready 是已过风险分级的可推帖子 */
function pushReason(state, ready, now) {
  if (!ready.length || isQuiet(now)) return ''
  const slotAt = latestSlotAt(now)
  if (slotAt > (state.lastSlotAt || 0)) return 'slot'
  // 00:30 之后只补最后一轮，不再提前推或插队
  if (beijingMinutes(now) >= 30 && beijingMinutes(now) < QUIET_START) return ''
  if (ready.some((item) => item.urgent) && now - (state.lastUrgentAt || 0) >= URGENT_GAP_MS) return 'urgent'
  if (ready.length >= VOLUME_TRIGGER && now - (state.lastPushAt || 0) >= VOLUME_GAP_MS) return 'volume'
  return ''
}

/** 每 2 分钟一次：先合并曝光计数，再看要不要推；结果记进 live 供后台查看 */
async function tick(options = {}) {
  const result = await tickInner(options)
  live.lastTickAt = options.now || Date.now()
  live.lastTick = result
  if (result && result.results) live.lastPush = { at: live.lastTickAt, ...result }
  return result
}

async function tickInner({ force = false, now = Date.now() } = {}) {
  if (running) return { skipped: 'running' }
  running = true
  try {
    await exposureFold.fold(now).catch((err) => console.warn('[exposure-fold]', err && err.message))
    if (!force && !(await isEnabled(now))) return { skipped: 'disabled' }
    if (!force && now < pausedUntil) return { skipped: 'paused' }
    if (!force && isQuiet(now)) return { skipped: 'quiet' }
    const state = await loadState()
    const queued = (await db.allDocs('digest_queue'))
      .sort((a, b) => ((a.queuedAt || 0) - (b.queuedAt || 0)) || String(a.id).localeCompare(String(b.id)))
    const slotAt = latestSlotAt(now)
    if (!queued.length) {
      // 到点但没帖子：记下这一轮已经过了，免得帖子晚到几分钟时被当成到点轮
      if (slotAt > (state.lastSlotAt || 0)) await db.setDoc('meta', STATE_ID, { ...state, id: STATE_ID, lastSlotAt: slotAt })
      return { queued: 0 }
    }
    const token = await wecomToken()
    const ready = await sortQueue(token, queued)
    const reason = force ? 'force' : pushReason(state, ready, now)
    if (!reason) {
      if (!ready.length && slotAt > (state.lastSlotAt || 0)) await db.setDoc('meta', STATE_ID, { ...state, id: STATE_ID, lastSlotAt: slotAt })
      return { queued: queued.length, ready: ready.length, skipped: 'not_due' }
    }
    const confirmed = await recheckBeforePush(ready)
    if (!confirmed.length) return { queued: queued.length, ready: 0 }
    const results = await pushRound(token, confirmed)
    const ok = results.some((r) => r.ok)
    if (ok) {
      pausedUntil = 0
      await db.setDoc('meta', STATE_ID, {
        id: STATE_ID,
        lastPushAt: now,
        lastSlotAt: Math.max(state.lastSlotAt || 0, slotAt),
        lastUrgentAt: ready.some((item) => item.urgent) ? now : (state.lastUrgentAt || 0)
      })
    } else {
      pausedUntil = now + RETRY_PAUSE_MS
    }
    results.forEach((r) => {
      const detail = r.ok ? '已建群发，等群主确认发送' : `失败：${JSON.stringify(r.sends.map((s) => s.result))}`
      console.log(`[wecom-auto] (${reason}) ${r.digest} ${r.count} 条 → ${detail}`)
    })
    return { ok, reason, results }
  } catch (err) {
    pausedUntil = now + RETRY_PAUSE_MS
    console.error('[wecom-auto]', err && err.message)
    return { error: err && err.message }
  } finally {
    running = false
  }
}

function start() {
  if (process.env.WECOM_AUTO_SEND !== '1') return false
  if (!process.env.WECOM_CORP_ID || !process.env.WECOM_SECRET) {
    console.warn('[wecom-auto] 企微参数没配齐，自动推送未启动')
    return false
  }
  live.started = true
  live.startedAt = Date.now()
  setInterval(() => { tick() }, TICK_MS)
  setTimeout(() => { tick() }, 15000)
  console.log('[wecom-auto] 企微自动推送已启动：固定时段 + 满 8 条提前 + 急事插队，08:00–00:30')
  return true
}

/** 下一个固定时段（毫秒）；夜间返回早上 8 点 */
function nextSlotAt(now = Date.now()) {
  const dayStart = Math.floor((now + 8 * 3600 * 1000) / (24 * 3600 * 1000)) * 24 * 3600 * 1000 - 8 * 3600 * 1000
  const all = []
  for (const offset of [0, 1]) {
    for (const slot of SLOTS) {
      const [h, m] = slot.split(':').map(Number)
      all.push(dayStart + offset * 24 * 3600 * 1000 + (h * 60 + m) * MIN)
    }
  }
  return all.filter((at) => at > now).sort((a, b) => a - b)[0]
}

/** 后台「企微群发」页用的状态汇总 */
async function getStatus(now = Date.now()) {
  const [state, queue, logs, enabled] = await Promise.all([
    loadState(),
    db.allDocs('digest_queue').catch(() => []),
    db.recentDocs('distribute_logs', 12).catch(() => []),
    isEnabled(now)
  ])
  const online = live.started && now - live.lastTickAt < TICK_MS * 2 + 30000
  return {
    running: live.started,
    online,
    enabled,
    pausedUntil: pausedUntil > now ? pausedUntil : 0,
    quiet: isQuiet(now),
    startedAt: live.startedAt,
    lastTickAt: live.lastTickAt,
    lastPushAt: state.lastPushAt || 0,
    nextSlotAt: nextSlotAt(now),
    queue: {
      total: queue.length,
      pendingConfirm: queue.filter((item) => item.confirm === 'pending').length,
      urgent: queue.filter((item) => item.urgent).length
    },
    logs: logs
      .filter((item) => item.contentType === 'digest' || item.contentType === 'push_skip')
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 8)
      .map((item) => ({
        at: item.createdAt || 0,
        status: item.status,
        title: item.title,
        count: item.itemCount || 0,
        reasons: item.reasons || [],
        error: item.status === 'failed'
          ? JSON.stringify((item.wecom && (item.wecom.sends || []).map((s) => s.result && s.result.errmsg)) || item.wecom && item.wecom.error || '').slice(0, 120)
          : ''
      }))
  }
}

module.exports = { start, tick, buildText, pushReason, latestSlotAt, isQuiet, nextSlotAt, getStatus, setEnabled, isEnabled, PER_MESSAGE }
