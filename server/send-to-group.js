const { loadEnv } = require('./load-env')
const {
  getWecomToken,
  findChatIdByName,
  sendDigestToExternalGroup
} = require('./wecom-distribute')

loadEnv()

async function findChatId(token) {
  return findChatIdByName(token, process.env.WECOM_GROUP_NAME || '群聊推送测试')
}

async function main() {
  if (!process.env.WECOM_CORP_ID || !process.env.WECOM_SECRET || !process.env.WECOM_SENDER) {
    console.log('先把 server/.env 里的企业ID、Secret、群主账号填好。')
    console.log('开发者可以不在这家公司，但这 3 个数必须由公司里的人提供。')
    process.exit(1)
  }

  const token = await getWecomToken()
  const chatId = await findChatId(token)
  if (!chatId) {
    console.log('没找到「群聊推送测试」。先运行：node server/list-groups.js')
    process.exit(1)
  }

  const card = {
    title: '黎安话事精选 · 10条汇总',
    summary: '点开小程序查看二手、拼车、拼单、求助。',
    text: [
      '黎安话事精选 · 10条汇总',
      '',
      '同学可在微信里打开黎安话事小程序查看详情。',
      '管理端生成汇总后，群主在企业微信确认发送即可。'
    ].join('\n'),
    appid: process.env.MINI_APPID || '',
    wecomPage: 'pages/digest/digest.html'
  }

  const result = await sendDigestToExternalGroup(token, card, [chatId], process.env.WECOM_SENDER)
  console.log(result)
  if (result.errcode) {
    console.log('发送失败：', result.errmsg)
    process.exit(1)
  }

  console.log('\n已经创建群发任务。')
  console.log('请让群主打开自己的企业微信，点一下「确认发送」。')
  console.log('群主确认后，同学就能在「群聊推送测试」里看到消息。')
}

main().catch((err) => {
  console.log('出错了：', err.message || err)
  process.exit(1)
})
