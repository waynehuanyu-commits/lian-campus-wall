/**
 * 首页「围观」按曝光算：卡片一半以上进入屏幕就记一次。
 * - 同一次停留在首页时，同一帖只记一次；离开首页再回来重新算
 * - 攒 3 秒或 20 条报一次云函数 bumpExposure，离开页面时把剩下的报掉
 * - 云端先记进 10 分钟一桶的缓冲，成都服务器再合进帖子的 viewCount，所以数字最多晚十几分钟
 * 卡片节点需要带 data-id / data-type，选择器由页面传入。
 */
const repo = require('./repo')

const FLUSH_DELAY = 3000
const FLUSH_SIZE = 20

function createExposureTracker(page, selector) {
  let observer = null
  let seen = new Set()
  let pending = []
  let timer = null

  function flush() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!pending.length) return
    const batch = pending.splice(0, 60)
    repo.bumpExposure(batch).catch(() => {})
  }

  function mark(dataset) {
    const id = dataset && dataset.id
    if (!id) return
    const type = dataset.type === 'wall' ? 'wall' : 'forum'
    const key = `${type}:${id}`
    if (seen.has(key)) return
    seen.add(key)
    pending.push({ type, id })
    if (pending.length >= FLUSH_SIZE) flush()
    else if (!timer) timer = setTimeout(flush, FLUSH_DELAY)
  }

  /** 列表渲染完（setData 回调里）调用：重新观察当前所有卡片 */
  function observe() {
    if (observer) observer.disconnect()
    try {
      observer = page.createIntersectionObserver({ observeAll: true, thresholds: [0.5] })
      observer.relativeToViewport().observe(selector, (res) => {
        if (res && res.intersectionRatio >= 0.5) mark(res.dataset)
      })
    } catch (err) {
      observer = null
    }
  }

  /** 离开首页：报掉剩下的，下次回来重新计 */
  function pause() {
    flush()
    seen = new Set()
  }

  function destroy() {
    flush()
    if (observer) observer.disconnect()
    observer = null
  }

  return { observe, pause, destroy, flush }
}

module.exports = { createExposureTracker }
