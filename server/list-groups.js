const fs = require('fs')
const path = require('path')
const { loadEnv } = require('./load-env')
const {
  getWecomToken,
  ownerUserids,
  listAllCustomerGroups,
  getCustomerGroup
} = require('./wecom-distribute')

loadEnv()

function upsertDotEnv(file, key, value) {
  const nextLine = `${key}=${value}`
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const re = new RegExp(`^${key}=.*$`, 'm')
  if (re.test(text)) text = text.replace(re, nextLine)
  else text = `${text.replace(/\s*$/, '')}\n${nextLine}\n`
  fs.writeFileSync(file, text)
}

function upsertEnvLocalJs(file, key, value) {
  if (!fs.existsSync(file)) return
  const text = fs.readFileSync(file, 'utf8')
  const re = new RegExp(`(${key}\\s*:\\s*)(['"\`])(.*?)\\2`)
  if (!re.test(text)) return
  fs.writeFileSync(file, text.replace(re, `$1$2${value}$2`))
}

function persistChatId(chatId) {
  const root = path.join(__dirname, '..')
  upsertDotEnv(path.join(__dirname, '.env'), 'WECOM_CHAT_ID', chatId)
  upsertDotEnv(path.join(root, 'cloudfunctions/userApi/.env'), 'WECOM_CHAT_ID', chatId)
  upsertEnvLocalJs(path.join(root, 'cloudfunctions/userApi/env.local.js'), 'WECOM_CHAT_ID', chatId)
  process.env.WECOM_CHAT_ID = chatId
}

async function main() {
  if (!process.env.WECOM_CORP_ID || !process.env.WECOM_SECRET) {
    console.log('先把 server/.env 里的企业ID 和 Secret 填好。')
    console.log('这两项由公司里能进企微后台的人提供。')
    process.exit(1)
  }

  const owners = ownerUserids()
  console.log('按官方文档获取客户群列表：POST /cgi-bin/externalcontact/groupchat/list')
  console.log(`status_filter=${process.env.WECOM_STATUS_FILTER || 0}  limit=${process.env.WECOM_GROUP_LIST_LIMIT || 100}`)
  if (owners.length) {
    console.log(`owner_filter.userid_list=${owners.join(',')}`)
  } else {
    console.log('未填 WECOM_OWNER_USERID，将拉取应用可见范围内全部群主的客户群。')
    console.log('若可见范围超过 1000 人会报 81017，那时必须填群主 userid。')
  }
  console.log('')

  const token = await getWecomToken()
  const chats = await listAllCustomerGroups(token)
  if (!chats.length) {
    console.log('一个客户群都没拉到。请确认：')
    console.log('1. Secret 来自开通「客户联系」的自建应用')
    console.log('2. 群主在该应用可见范围里')
    console.log('3. 这是外部客户群（企微群主 + 微信同学），不是内部群')
    if (owners.length) {
      console.log('4. WECOM_OWNER_USERID 必须是群主账号，不是群成员。当前填的是：' + owners.join(','))
    }
    process.exit(0)
  }

  const targetName = String(process.env.WECOM_GROUP_NAME || '群聊推送测试').trim()
  let matched = ''

  console.log(`共 ${chats.length} 个客户群（本页只返回 chat_id，群名来自 groupchat/get）：\n`)
  for (const item of chats) {
    const detail = await getCustomerGroup(token, item.chat_id)
    if (detail.errcode) {
      console.log(`chat_id：${item.chat_id}`)
      console.log(`详情失败：${detail.errmsg}`)
      console.log('')
      continue
    }
    const group = detail.group_chat || {}
    const name = group.name || '未命名群'
    const owner = group.owner || ''
    console.log(`群名：${name}`)
    console.log(`chatId：${item.chat_id}`)
    console.log(`群主 userid：${owner}`)
    console.log('')
    if (!matched && name.includes(targetName)) matched = item.chat_id
  }

  if (matched) {
    persistChatId(matched)
    console.log(`已找到「${targetName}」，chatId 已写入：`)
    console.log('  server/.env')
    console.log('  cloudfunctions/userApi/.env')
    console.log('  cloudfunctions/userApi/env.local.js')
    console.log('然后再运行：node server/send-to-group.js')
    return
  }

  console.log(`没有名字包含「${targetName}」的客户群。`)
  console.log('找到后把对应 chatId 填进 server/.env 的 WECOM_CHAT_ID。')
}

main().catch((err) => {
  console.log('出错了：', err.message || err)
  process.exit(1)
})
