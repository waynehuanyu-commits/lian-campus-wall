// 企微自动推送（只在成都服务器的 liaan-admin 进程里跑，systemd 里设 WECOM_AUTO_SEND=1 才启动；
// 8788 那个手动进程不设，避免同一批推两次）。
//
// 链路：发帖 / 人工审核通过 → digest_queue（每帖一条 dq_<帖子id>，见 utils/home-feed.js digestQueueItem）
//      → 本模块每 2 分钟看一次，攒满 10 条就生成汇总 digests，调企微 add_msg_template 给客户群建群发
//      → 发送人（客户群群主）在企业微信里点「发送」，消息才进群。这一步是企微对外部客户群的硬规定，绕不过去。
//
// 为什么放在服务器而不是云函数：企微只认「企业可信IP」，成都服务器 118.24.61.135 已加白名单，云函数出口 IP 不固定。
// 配置都在 server/.env：WECOM_CORP_ID / WECOM_SECRET / WECOM_SENDER / WECOM_CHAT_ID，小程序卡片和短链用 MINI_APPID / MINI_SECRET。

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const db = require('./db')

const DIGEST_SIZE = 10
const TICK_MS = 2 * 60 * 1000
const COVER_FILE = path.join(__dirname, '../../images/share-card.jpg')
const WECOM_HOST = 'https://qyapi.weixin.qq.com'
const WX_HOST = 'https://api.weixin.qq.com'

let running = false
// 推送失败（如发送人不是群主、token 失效）后暂停 30 分钟再试，帖子放回队列不丢
let pausedUntil = 0
const RETRY_PAUSE_MS = 30 * 60 * 1000
let coverCache = { id: '', at: 0 }

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
        page_title: String(item.title || '查看').replace(/\s+/g, '').slice(0, 12) || '查看',
        is_permanent: false
      })
      if (res.link) out[item.contentId] = res.link
    }
    return out
  } catch (err) {
    return {}
  }
}

// 去掉被截成半个的表情（孤立代理字符），否则企微整条报 40058
function cleanText(text) {
  return String(text || '').replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
}

function clip(text, max) {
  return Array.from(cleanText(text)).slice(0, max).join('')
}

/** 群消息正文：标题 + 摘要 + 短链，不出现小程序内部路径 */
function buildText(digest, links) {
  const lines = (digest.items || []).map((item, index) => {
    const summary = item.summary && item.summary !== item.title ? `\n${clip(item.summary, 40)}` : ''
    const link = links[item.contentId] ? `\n${links[item.contentId]}` : ''
    return `${index + 1}. 【${cleanText(item.channel) || '校园话题'}】${cleanText(item.title)}${summary}${link}`
  })
  const text = [
    `黎安话事 · 最新 ${lines.length} 条`,
    '',
    lines.join('\n\n'),
    '',
    '打开小程序「黎安话事」看全文、参与评论'
  ].join('\n')
  return clip(text, 3900)
}

async function targetChatIds() {
  const groups = await db.allDocs('distribute_targets').catch(() => [])
  const ids = groups
    .filter((item) => item.enabled !== false && item.receiveDigest && item.chatId)
    .map((item) => item.chatId)
  if (ids.length) return ids
  return process.env.WECOM_CHAT_ID ? [process.env.WECOM_CHAT_ID] : []
}

async function createGroupMessage(token, digest, chatIds, links) {
  const payload = {
    chat_type: 'group',
    chat_id_list: chatIds,
    sender: process.env.WECOM_SENDER,
    text: { content: buildText(digest, links) }
  }
  const cover = await coverMediaId(token).catch(() => '')
  if (cover && process.env.MINI_APPID) {
    const withCard = await postJson(`${WECOM_HOST}/cgi-bin/externalcontact/add_msg_template?access_token=${token}`, {
      ...payload,
      attachments: [{
        msgtype: 'miniprogram',
        miniprogram: {
          title: clip(digest.title, 20),
          pic_media_id: cover,
          appid: process.env.MINI_APPID,
          page: `pages/digest/digest.html?id=${digest.id}`
        }
      }]
    })
    if (!withCard.errcode) return { ...withCard, card: true }
    // 小程序没关联企微等原因导致卡片发不了，退回纯文字，至少把内容推出去
    const textOnly = await postJson(`${WECOM_HOST}/cgi-bin/externalcontact/add_msg_template?access_token=${token}`, payload)
    return { ...textOnly, card: false, cardError: `${withCard.errcode} ${withCard.errmsg}` }
  }
  const res = await postJson(`${WECOM_HOST}/cgi-bin/externalcontact/add_msg_template?access_token=${token}`, payload)
  return { ...res, card: false }
}

/** 队列满 10 条 → 生成汇总并建群发。返回本轮做了什么，方便日志和手动触发 */
async function tick({ force = false } = {}) {
  if (running) return { skipped: 'running' }
  if (!force && Date.now() < pausedUntil) return { skipped: 'paused' }
  running = true
  try {
    const queued = (await db.allDocs('digest_queue')).sort((a, b) => ((a.queuedAt || 0) - (b.queuedAt || 0)) || String(a.id).localeCompare(String(b.id)))
    if (!queued.length || (!force && queued.length < DIGEST_SIZE)) return { queued: queued.length }
    const picked = queued.slice(0, DIGEST_SIZE)
    const items = picked.map(({ _id, ...rest }) => rest)
    const digest = {
      id: uid('dg_'),
      items,
      title: `黎安话事 · 最新 ${items.length} 条`,
      summary: items.map((item, index) => `${index + 1}.${item.title}`).join(' ').slice(0, 120),
      source: 'wecom_auto',
      createdAt: Date.now()
    }
    digest.pagepath = `pages/digest/digest?id=${digest.id}`
    digest.sharePath = `/pages/digest/digest?id=${digest.id}`
    await db.setDoc('digests', digest.id, digest)
    // 先出汇总再删队列：中途失败最多重复推一次，不会丢帖
    await Promise.all(picked.map((item) => db.removeDoc('digest_queue', item.id || item._id).catch(() => {})))

    let wecom
    try {
      const chatIds = await targetChatIds()
      if (!chatIds.length) throw new Error('没有绑定要推送的客户群（WECOM_CHAT_ID）')
      const token = await wecomToken()
      const links = await shortLinks(items)
      wecom = { chatIds, result: await createGroupMessage(token, digest, chatIds, links) }
    } catch (err) {
      wecom = { error: err.message || String(err) }
    }
    const ok = !!(wecom.result && !wecom.result.errcode)
    const log = {
      id: uid('dl_'),
      groupType: 'external',
      groupName: process.env.WECOM_GROUP_NAME || '',
      contentType: 'digest',
      contentId: digest.id,
      title: digest.title,
      summary: digest.summary,
      pagepath: digest.pagepath,
      items,
      itemCount: items.length,
      status: ok ? 'confirm' : 'failed',
      wecom,
      createdAt: Date.now()
    }
    await db.setDoc('distribute_logs', log.id, log)
    if (!ok) {
      // 帖子放回队列，下次重试；同一帖固定 dq_<帖子id>，不会重复
      await Promise.all(items.map((item) => db.setDoc('digest_queue', item.id, item).catch(() => {})))
      pausedUntil = Date.now() + RETRY_PAUSE_MS
    } else {
      pausedUntil = 0
    }
    await db.setDoc('digests', digest.id, { ...digest, wecomStatus: log.status, wecom })
    console.log(`[wecom-auto] ${digest.id} ${items.length} 条 → ${ok ? '已建群发，等发送人确认' : `失败：${wecom.error || JSON.stringify(wecom.result)}`}`)
    return { digest: digest.id, ok, wecom }
  } catch (err) {
    console.error('[wecom-auto]', err && err.message)
    return { error: err && err.message }
  } finally {
    running = false
  }
}

function start() {
  if (process.env.WECOM_AUTO_SEND !== '1') return false
  if (!process.env.WECOM_CORP_ID || !process.env.WECOM_SECRET || !process.env.WECOM_SENDER) {
    console.warn('[wecom-auto] 企微参数没配齐，自动推送未启动')
    return false
  }
  setInterval(() => { tick() }, TICK_MS)
  setTimeout(() => { tick() }, 15000)
  console.log('[wecom-auto] 企微自动推送已启动：每 2 分钟检查一次，满 10 条推送')
  return true
}

module.exports = { start, tick, buildText, DIGEST_SIZE }
