/**
 * 联调：mock 满 10 条队列 → 走 flushDigest → 企微 add_msg_template
 * 用法：node server/mock-digest-push.js
 * 默认 ADMIN_LOCAL=1（队列/汇总写本地），企微仍调真实接口。
 */
process.env.ADMIN_LOCAL = process.env.ADMIN_LOCAL || '1'
const { loadEnv } = require('./load-env')
loadEnv()

async function main() {
  const service = require('../admin/lib/service')
  console.log('=== Mock 满 10 条并自动推企微 ===')
  console.log(`群：${process.env.WECOM_GROUP_NAME || ''}  chatId=${process.env.WECOM_CHAT_ID || ''}  sender=${process.env.WECOM_SENDER || ''}`)
  const result = await service.mockDigestFullAndPush()
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
  const wecom = result.flushed && result.flushed.wecom
  if (wecom && wecom.ok) {
    console.log('\n企微任务已创建。请乘璟在企业微信点「确认发送」。')
  } else {
    console.log('\n汇总可能已生成，但企微未成功：', wecom && wecom.message)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
