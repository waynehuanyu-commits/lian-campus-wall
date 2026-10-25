const https = require('https')
require('./load-env')

const WECOM_HOST = 'qyapi.weixin.qq.com'

function requestJson(method, path, body) {
  const payload = body ? JSON.stringify(body) : ''
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: WECOM_HOST,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
        } catch (err) {
          reject(err)
        }
      })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function envStatus() {
  const missing = []
  if (!process.env.WECOM_CORP_ID) missing.push('企业ID')
  if (!process.env.WECOM_SECRET) missing.push('应用Secret')
  if (!process.env.WECOM_SENDER) missing.push('群主账号')
  return {
    ready: missing.length === 0,
    missing,
    groupName: process.env.WECOM_GROUP_NAME || '群聊推送测试',
    sender: process.env.WECOM_SENDER || ''
  }
}

async function getWecomToken() {
  const data = await requestJson('GET', `/cgi-bin/gettoken?corpid=${process.env.WECOM_CORP_ID}&corpsecret=${process.env.WECOM_SECRET}`)
  if (data.errcode) throw new Error(data.errmsg || '拿企微 token 失败')
  return data.access_token
}

function ownerUserids() {
  const raw = String(process.env.WECOM_OWNER_USERID || process.env.WECOM_OWNER || '').trim()
  return raw.split(/[,，\s]+/).map((id) => id.trim()).filter(Boolean).slice(0, 100)
}

function buildGroupChatListBody(cursor) {
  const limit = Number(process.env.WECOM_GROUP_LIST_LIMIT || 100)
  const body = {
    status_filter: Number(process.env.WECOM_STATUS_FILTER || 0),
    limit: Math.min(1000, Math.max(1, Number.isFinite(limit) ? limit : 100))
  }
  const useridList = ownerUserids()
  if (useridList.length) {
    body.owner_filter = { userid_list: useridList }
  }
  if (cursor) body.cursor = cursor
  return body
}

async function listCustomerGroups(wecomToken, cursor = '') {
  return requestJson(
    'POST',
    `/cgi-bin/externalcontact/groupchat/list?access_token=${wecomToken}`,
    buildGroupChatListBody(cursor)
  )
}

async function getCustomerGroup(wecomToken, chatId) {
  return requestJson('POST', `/cgi-bin/externalcontact/groupchat/get?access_token=${wecomToken}`, {
    chat_id: chatId,
    need_name: 1
  })
}

function extractDeniedIp(errmsg) {
  const text = String(errmsg || '')
  const match = text.match(/from ip:\s*([0-9.]+)/i)
  return match ? match[1] : ''
}

function formatGroupListError(data) {
  const code = data && data.errcode
  const msg = (data && data.errmsg) || '拉客户群失败'
  if (code === 60020) {
    const ip = extractDeniedIp(msg)
    return ip
      ? `60020 云函数出口 IP ${ip} 不在应用「企业可信IP」里。请把 ${ip} 加进该自建应用的企业可信IP。`
      : '60020 当前出口 IP 不在应用「企业可信IP」里。云函数出口 IP 需加到该自建应用的企业可信IP。'
  }
  if (code === 81017) {
    return '81017 应用可见范围人数超过 1000。请填写 WECOM_OWNER_USERID（群主 userid）。'
  }
  return `${code || ''} ${msg}`.trim()
}

async function findChatIdByName(wecomToken, name) {
  const target = String(name || process.env.WECOM_GROUP_NAME || '群聊推送测试').trim()
  if (process.env.WECOM_CHAT_ID) return process.env.WECOM_CHAT_ID
  let cursor = ''
  do {
    const list = await listCustomerGroups(wecomToken, cursor)
    if (list.errcode) throw new Error(formatGroupListError(list))
    for (const item of list.group_chat_list || []) {
      const detail = await getCustomerGroup(wecomToken, item.chat_id)
      const groupName = (detail.group_chat && detail.group_chat.name) || ''
      if (groupName.includes(target)) return item.chat_id
    }
    cursor = list.next_cursor || ''
  } while (cursor)
  return ''
}

async function sendDigestToExternalGroup(wecomToken, card, chatIdList, sender) {
  const cover = process.env.MINI_COVER_MEDIA_ID || ''
  const appid = card.appid || process.env.MINI_APPID || ''
  const payload = {
    chat_type: 'group',
    chat_id_list: chatIdList,
    sender: sender || process.env.WECOM_SENDER,
    text: {
      content: (card.text || `${card.title}\n${card.summary}`).slice(0, 4000)
    }
  }
  if (cover && appid && cover !== 'MEDIA_ID') {
    payload.attachments = [
      {
        msgtype: 'miniprogram',
        miniprogram: {
          title: String(card.title || '黎安话事精选汇总').slice(0, 20),
          pic_media_id: cover,
          appid,
          page: card.wecomPage || 'pages/digest/digest.html'
        }
      }
    ]
  }
  return requestJson('POST', `/cgi-bin/externalcontact/add_msg_template?access_token=${wecomToken}`, payload)
}

async function sendDigest(digest, options = {}) {
  const status = envStatus()
  if (!status.ready) {
    return { skipped: true, message: `云函数还没配齐企微参数：${status.missing.join('、')}` }
  }
  const token = await getWecomToken()
  let chatIds = (options.chatIds || []).filter(Boolean)
  if (!chatIds.length && process.env.WECOM_CHAT_ID) chatIds = [process.env.WECOM_CHAT_ID]
  if (!chatIds.length) {
    const found = await findChatIdByName(token, status.groupName)
    if (found) chatIds = [found]
  }
  if (!chatIds.length) {
    return { skipped: false, error: `没找到客户群「${status.groupName}」，请先在后台绑定 chatId` }
  }
  const card = {
    title: digest.title,
    summary: digest.summary,
    text: [
      digest.title,
      digest.summary,
      '',
      (digest.items || []).map((item, index) => `${index + 1}. ${item.title}\n摘要：${item.summary || ''}\n入口：${item.pagepath}`).join('\n\n'),
      '',
      '点开小程序进入汇总页，再点对应条目查看详情。'
    ].join('\n'),
    appid: process.env.MINI_APPID || process.env.WECOM_MINI_APPID || '',
    wecomPage: digest.wecomPage || `pages/digest/digest.html?id=${digest.id}`
  }
  const result = await sendDigestToExternalGroup(
    token,
    card,
    chatIds,
    options.sender || process.env.WECOM_SENDER
  )
  return { skipped: false, chatId: chatIds[0], chatIds, result }
}

module.exports = {
  envStatus,
  sendDigest
}
