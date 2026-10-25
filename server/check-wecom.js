/**
 * 企微链路自检：出口 IP、token、客户群、chatId。
 * 用法：node server/check-wecom.js
 */
const { loadEnv } = require('./load-env')
const {
  envStatus,
  getWecomToken,
  listAllCustomerGroups,
  getCustomerGroup,
  findChatIdByName
} = require('./wecom-distribute')

loadEnv()

async function publicIpv4() {
  const urls = [
    'https://api.ipify.org',
    'https://ipv4.icanhazip.com',
    'https://ifconfig.me/ip'
  ]
  for (const url of urls) {
    try {
      const text = String(await fetch(url).then((res) => res.text())).trim()
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return text
    } catch (err) {
      // try next
    }
  }
  return ''
}

async function main() {
  const status = envStatus()
  const ip = await publicIpv4()
  console.log('=== 企微自检 ===')
  console.log(`本机出口 IPv4：${ip || '未取到（请确认网络）'}`)
  console.log(`配置：${status.ready ? '已齐' : `缺 ${status.missing.join('、')}`}`)
  console.log(`群主 sender：${status.sender || '（空）'}`)
  console.log(`目标群名：${status.groupName}`)
  console.log(`WECOM_CHAT_ID：${process.env.WECOM_CHAT_ID || '（空，需绑定）'}`)
  console.log(`小程序封面 media：${status.hasCover ? '已配' : '未配（可先发纯文字）'}`)
  console.log('')

  if (!status.ready) {
    console.log('先把 server/.env 里的企业ID、Secret、群主账号填好。')
    process.exit(1)
  }

  if (ip) {
    console.log('若报 60020：到企微后台 → 应用管理 → 该自建应用 → 企业可信IP')
    console.log(`把本机 IP 加进去：${ip}`)
    console.log('云函数自动群发还要把云函数出口 IP 也加上（可用小程序/后台诊断或看 60020 原文）。')
    console.log('')
  }

  try {
    const token = await getWecomToken()
    console.log('access_token：OK')
    const chats = await listAllCustomerGroups(token)
    console.log(`客户群数量：${chats.length}`)
    const target = status.groupName
    let matched = ''
    for (const item of chats) {
      const detail = await getCustomerGroup(token, item.chat_id)
      const name = (detail.group_chat && detail.group_chat.name) || '未命名群'
      const owner = (detail.group_chat && detail.group_chat.owner) || ''
      const mark = name.includes(target) ? ' ← 目标' : ''
      console.log(`- ${name} | ${item.chat_id} | 群主 ${owner}${mark}`)
      if (!matched && name.includes(target)) matched = item.chat_id
    }
    if (!matched) matched = await findChatIdByName(token, target)
    console.log('')
    if (matched) {
      console.log(`下一步：node server/list-groups.js  （会写入 WECOM_CHAT_ID=${matched}）`)
      console.log('然后：node server/send-to-group.js  （群主在企微点确认发送）')
    } else {
      console.log(`没找到名字包含「${target}」的客户群。确认是外部客户群，且群主在应用可见范围。`)
    }
  } catch (err) {
    const message = String(err.message || err)
    console.log('调用失败：', message)
    const denied = (message.match(/出口 IP\s+([0-9.]+)/) || [])[1]
    if (message.includes('60020')) {
      console.log(`请先把企微看到的出口 IP ${denied || ip || '（见上文）'} 加入该自建应用的「企业可信IP」，保存后再跑本脚本。`)
      console.log('（以 60020 原文里的 IP 为准；本机探测 IP 可能因代理不一致。）')
    }
    process.exit(1)
  }
}

main()
