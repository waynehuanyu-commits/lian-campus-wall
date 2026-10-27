/**
 * Mock：把 digest_queue 补到 10 条，走与「攒满自动推」相同的 flushDigest（生成汇总 + 企微群发）。
 * 用法：node server/mock-digest-10.js
 */
const fs = require('fs')
const path = require('path')
const { loadEnv } = require('./load-env')
const { uid } = require('../utils/util')

loadEnv()
const adminEnv = path.join(__dirname, '../admin/.env')
if (fs.existsSync(adminEnv)) {
  fs.readFileSync(adminEnv, 'utf8').split(/\r?\n/).forEach((line) => {
    const text = line.trim()
    if (!text || text.startsWith('#')) return
    const index = text.indexOf('=')
    if (index < 1) return
    const key = text.slice(0, index).trim()
    const value = text.slice(index + 1).trim()
    if (!process.env[key]) process.env[key] = value
  })
}

const db = require('../admin/lib/db')
const service = require('../admin/lib/service')

const DIGEST_SIZE = 10

async function main() {
  console.log('=== Mock 满 10 条自动推企微 ===')
  console.log(`群：${process.env.WECOM_GROUP_NAME || '（空）'}`)
  console.log(`CHAT_ID：${process.env.WECOM_CHAT_ID || '（空）'}`)
  console.log(`SENDER：${process.env.WECOM_SENDER || '（空）'}`)
  console.log(`云库：${db.useLocal() ? '本地演示' : 'CloudBase'}`)
  console.log('')

  await db.ensureCollection('digest_queue')
  const queued = (await db.allDocs('digest_queue')).sort((a, b) => (a.queuedAt || 0) - (b.queuedAt || 0))
  console.log(`当前队列：${queued.length} 条`)

  const need = Math.max(0, DIGEST_SIZE - queued.length)
  const now = Date.now()
  for (let i = 0; i < need; i += 1) {
    const id = uid('dq_')
    const n = queued.length + i + 1
    await db.setDoc('digest_queue', id, {
      id,
      contentType: 'wall',
      contentId: `mock_wall_${now}_${n}`,
      title: `【Mock】测试帖 ${n}`,
      summary: `自动推送联调占位内容 ${n}，可忽略。`,
      channel: '互助广场 · Mock',
      pagepath: `pages/wall-detail/wall-detail?id=mock_wall_${now}_${n}`,
      queuedAt: now + i,
      mock: true
    })
  }
  if (need) console.log(`已补入 Mock ${need} 条，队列现应 ≥ ${DIGEST_SIZE}`)
  else console.log('队列已满 10 条，不再补 Mock')

  console.log('\n调用 flushDigest(false)（与审核入队攒满后同一路径）…\n')
  const result = await service.flushDigest(false)
  console.log(JSON.stringify(result, null, 2))

  if (result && result.ok) {
    console.log('\n推文已生成。')
    if (result.wecom && result.wecom.ok) {
      console.log('企微群发任务已创建。请乘璟在企业微信点「确认发送」。')
    } else {
      console.log('企微未成功：', (result.wecom && result.wecom.message) || result.message)
    }
  } else {
    console.log('\n失败：', (result && result.message) || 'unknown')
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('出错了：', err.message || err)
  process.exit(1)
})
