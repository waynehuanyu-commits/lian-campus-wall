/**
 * 企业微信自动分发（服务端，勿放进小程序包）。
 *
 * 必须走这条：客户群半自动群发。
 * 开发者可以不在这家公司，但要把公司里的人给的 3 个数配进环境变量。
 * 1. 校园墙关键词通过后入队（论坛不推）
 * 2. 满 10 条生成一份汇总：标题 + 摘要 + 小程序入口
 * 3. 云函数/后台调用 add_msg_template（WECOM_SENDER 填群主 userid）
 * 4. 群主在自己的企业微信确认一次
 * 5. 同学点小程序卡片 → pages/digest/digest?id=汇总ID
 *
 * 环境变量：
 * WECOM_CORP_ID / WECOM_SECRET / WECOM_SENDER
 * WECOM_OWNER_USERID（可选，92120 的群主 userid，最多 100 个，逗号分隔）
 * WECOM_CHAT_ID / WECOM_GROUP_NAME
 * MINI_APPID / MINI_SECRET / MINI_COVER_MEDIA_ID
 */

const WECOM_HOST = 'https://qyapi.weixin.qq.com'
const WX_HOST = 'https://api.weixin.qq.com'

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  return res.json()
}

async function getWecomToken() {
  const url = `${WECOM_HOST}/cgi-bin/gettoken?corpid=${process.env.WECOM_CORP_ID}&corpsecret=${process.env.WECOM_SECRET}`
  const data = await fetch(url).then((res) => res.json())
  if (data.errcode) throw new Error(`wecom token: ${data.errmsg}`)
  return data.access_token
}

async function getMiniToken() {
  const url = `${WX_HOST}/cgi-bin/token?grant_type=client_credential&appid=${process.env.MINI_APPID}&secret=${process.env.MINI_SECRET}`
  const data = await fetch(url).then((res) => res.json())
  if (data.errcode) throw new Error(`mini token: ${data.errmsg}`)
  return data.access_token
}

async function generateGroupLink(token, { path, query, title }) {
  const pageUrl = query ? `${path}?${query}` : path
  const pageTitle = String(title || '查看').replace(/\s+/g, '').slice(0, 12) || '查看'
  return postJson(`${WX_HOST}/wxa/genwxashortlink?access_token=${token}`, {
    page_url: pageUrl,
    page_title: pageTitle,
    is_permanent: false
  })
}

async function sendDigestByRobot(webhookUrl, card) {
  await postJson(webhookUrl, {
    msgtype: 'markdown',
    markdown: { content: card.markdown }
  })

  return postJson(webhookUrl, {
    msgtype: 'template_card',
    template_card: {
      card_type: 'text_notice',
      source: { desc: '校园墙汇总' },
      main_title: {
        title: card.title,
        desc: card.summary
      },
      sub_title_text: `共 ${card.items.length} 条，点击进入小程序阅读`,
      card_action: {
        type: 2,
        appid: card.appid || process.env.MINI_APPID,
        pagepath: card.pagepath
      }
    }
  })
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
  return postJson(`${WECOM_HOST}/cgi-bin/externalcontact/add_msg_template?access_token=${wecomToken}`, payload)
}

function envStatus() {
  const missing = []
  if (!process.env.WECOM_CORP_ID) missing.push('企业ID')
  if (!process.env.WECOM_SECRET) missing.push('应用Secret')
  if (!process.env.WECOM_SENDER) missing.push('群主账号')
  return {
    ready: missing.length === 0,
    missing,
    hasChatId: !!process.env.WECOM_CHAT_ID,
    groupName: process.env.WECOM_GROUP_NAME || '群聊推送测试',
    hasMiniAppId: !!process.env.MINI_APPID,
    hasCover: !!(process.env.MINI_COVER_MEDIA_ID && process.env.MINI_COVER_MEDIA_ID !== 'MEDIA_ID'),
    sender: process.env.WECOM_SENDER || ''
  }
}

function ownerUserids() {
  const raw = String(process.env.WECOM_OWNER_USERID || process.env.WECOM_OWNER || '').trim()
  return raw.split(/[,，\s]+/).map((id) => id.trim()).filter(Boolean).slice(0, 100)
}

/**
 * 获取客户群列表（官方文档 path/92120）
 * POST /cgi-bin/externalcontact/groupchat/list
 * 必填 limit；首次不传 cursor；群主建议用 owner_filter，避免可见范围过大报 81017。
 */
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
  return postJson(
    `${WECOM_HOST}/cgi-bin/externalcontact/groupchat/list?access_token=${wecomToken}`,
    buildGroupChatListBody(cursor)
  )
}

function formatGroupListError(data) {
  const code = data && data.errcode
  const msg = (data && data.errmsg) || '拉客户群失败'
  if (code === 60020) {
    return '60020 当前出口 IP 不在应用「企业可信IP」里。先到企微后台该自建应用填可信域名，再添加本机出口 IP。'
  }
  if (code === 81017) {
    return '81017 应用可见范围人数超过 1000。请在 .env 填写 WECOM_OWNER_USERID（群主 userid），用 owner_filter 缩小范围。'
  }
  if (code === 40013 || code === 40014 || code === 40001) {
    return `${code} access_token 无效。检查企业ID 和应用 Secret。`
  }
  return `${code || ''} ${msg}`.trim()
}

async function listAllCustomerGroups(wecomToken) {
  const chats = []
  let cursor = ''
  do {
    const list = await listCustomerGroups(wecomToken, cursor)
    if (list.errcode) throw new Error(formatGroupListError(list))
    chats.push(...(list.group_chat_list || []))
    cursor = list.next_cursor || ''
  } while (cursor)
  return chats
}

async function findChatIdByName(wecomToken, name) {
  const target = String(name || process.env.WECOM_GROUP_NAME || '群聊推送测试').trim()
  if (process.env.WECOM_CHAT_ID && (!name || target === (process.env.WECOM_GROUP_NAME || '群聊推送测试'))) {
    return process.env.WECOM_CHAT_ID
  }
  const chats = await listAllCustomerGroups(wecomToken)
  for (const item of chats) {
    const detail = await getCustomerGroup(wecomToken, item.chat_id)
    const groupName = (detail.group_chat && detail.group_chat.name) || ''
    if (groupName.includes(target)) return item.chat_id
  }
  return ''
}

async function listCustomerGroupsDetailed(wecomToken) {
  const chats = await listAllCustomerGroups(wecomToken)
  const detailed = []
  for (const item of chats) {
    const detail = await getCustomerGroup(wecomToken, item.chat_id)
    detailed.push({
      chatId: item.chat_id,
      name: (detail.group_chat && detail.group_chat.name) || '未命名群',
      owner: (detail.group_chat && detail.group_chat.owner) || ''
    })
  }
  return detailed
}

/** 获取客户群详情（官方文档 path/92122）。列表接口只返回 chat_id，群名必须再调这个。 */
async function getCustomerGroup(wecomToken, chatId) {
  return postJson(`${WECOM_HOST}/cgi-bin/externalcontact/groupchat/get?access_token=${wecomToken}`, {
    chat_id: chatId,
    need_name: 1
  })
}

async function attachItemUrlLinks(card) {
  if (!process.env.MINI_APPID || !process.env.MINI_SECRET) return card
  const token = await getMiniToken()
  const links = []
  for (const item of card.itemUrlLinkRequests || []) {
    const result = await generateGroupLink(token, item)
    const link = result.link || ''
    links.push({
      ...item,
      url_link: link,
      errcode: result.errcode || 0
    })
  }
  if (!links.length) return card
  const linkBlock = links
    .filter((item) => item.url_link)
    .map((item, index) => `${index + 1}. ${item.title}\n${item.url_link}`)
    .join('\n')
  return {
    ...card,
    itemUrlLinks: links,
    markdown: `${card.markdown}\n\n直达链接：\n${linkBlock}`,
    text: `${card.text}\n\n直达链接：\n${linkBlock}`
  }
}

async function distributeDigest(card, targets = []) {
  const withLinks = await attachItemUrlLinks(card)
  const wecomTargets = targets.filter((group) => group.enabled && group.receiveDigest)
  const needWecomToken = wecomTargets.some((group) => group.chatId || group.type === 'external')
  const wecomToken = needWecomToken ? await getWecomToken() : ''
  const results = []

  for (const group of wecomTargets) {
    if (group.webhook) {
      results.push({
        groupId: group.id,
        groupName: group.name,
        channel: 'robot',
        result: await sendDigestByRobot(group.webhook, withLinks)
      })
    }
    if (group.chatId) {
      results.push({
        groupId: group.id,
        groupName: group.name,
        channel: 'external',
        result: await sendDigestToExternalGroup(
          wecomToken,
          withLinks,
          [group.chatId],
          group.sender || process.env.WECOM_SENDER
        )
      })
    }
  }

  return { card: withLinks, results }
}

module.exports = {
  envStatus,
  generateUrlLink,
  sendDigestByRobot,
  sendDigestToExternalGroup,
  ownerUserids,
  listCustomerGroups,
  listAllCustomerGroups,
  listCustomerGroupsDetailed,
  findChatIdByName,
  getCustomerGroup,
  getWecomToken,
  distributeDigest
}
