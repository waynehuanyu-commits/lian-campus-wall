/**
 * 验证「自动」路径：只模拟审核通过入队，不主动 flush。
 * 第 1～9 条应只入队；第 10 条 enqueueApprovedWall 内部应自动 flush → add_msg_template。
 * 用法：node server/mock-enqueue-auto.js
 */
process.env.ADMIN_LOCAL = process.env.ADMIN_LOCAL || '1'
const { loadEnv } = require('./load-env')
loadEnv()

async function main() {
  const service = require('../admin/lib/service')
  const db = require('../admin/lib/db')

  // 清空队列，避免干扰
  const old = await db.allDocs('digest_queue')
  await Promise.all(old
    .filter((item) => item.id || item._id)
    .map((item) => db.removeDoc('digest_queue', item.id || item._id).catch(() => {})))

  console.log('=== 只走 enqueueApprovedWall（不手动 flush）===\n')

  for (let i = 1; i <= 10; i += 1) {
    const post = {
      id: `auto_wall_${Date.now()}_${i}`,
      title: `【自动入队 ${i}/10】`,
      content: '验证第 10 条是否自动调企微',
      tag: 'Mock',
      reviewStatus: 'approved'
    }
    const result = await service.enqueueApprovedWall(post)
    const flushed = !!(result && result.flushed)
    console.log(
      `#${i} count=${result && result.count} flushed=${flushed}` +
      (flushed ? ` wecom=${result.flushed.wecom && result.flushed.wecom.ok}` : '')
    )
    if (i < 10 && flushed) {
      console.log('异常：未满 10 条就 flush 了')
      process.exit(1)
    }
    if (i === 10) {
      if (!flushed) {
        console.log('\n失败：第 10 条没有自动 flush，说明不会自动调 add_msg_template')
        process.exit(1)
      }
      const wecom = result.flushed.wecom
      console.log('\n第 10 条触发了自动 flush。')
      console.log('企微结果：', JSON.stringify(wecom && (wecom.result || wecom), null, 2))
      if (wecom && wecom.ok) {
        console.log('\n结论：入队满 10 条会自动调用 add_msg_template（无需人手跑脚本）。')
        console.log('乘璟需在企微点「确认发送」。')
      } else {
        console.log('\n自动调用了发送逻辑，但企微失败：', wecom && wecom.message)
        process.exit(1)
      }
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
