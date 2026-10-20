const config = require('./utils/config')
const store = require('./utils/store')
const repo = require('./utils/repo')
const track = require('./utils/track')
const inbox = require('./utils/inbox')

App({
  onLaunch(options) {
    this.globalData.entryPath = (options && options.path) || ''
    this.globalData.entryQuery = (options && options.query) || {}
    this.globalData.ready = this.init()
  },

  onShow() {},

  onHide() {
    track.flush().catch(() => {})
  },

  async init() {
    // 清掉旧列表缓存，避免灰头像/旧布局数据残留
    if (typeof repo.purgeStaleFeedCaches === 'function') {
      repo.purgeStaleFeedCaches()
    }
    if (config.useCloud) {
      wx.cloud.init({
        env: config.cloudEnvId,
        traceUser: true
      })
      const path = this.globalData.entryPath || ''
      const isForum = !path || path === 'pages/forum/forum'
      const isWall = path === 'pages/wall/wall'
      // 头像规则变更后不信任旧缓存，首屏强制重拉
      repo.invalidateLocalFeeds()
      // 任意入口都先完成登录态；只有首页/广场首屏顺带拉列表
      const result = await repo.bootstrap({
        includeForum: isForum,
        includeWall: isWall
      })
      if (!result.ok) {
        wx.showToast({ title: result.message || '云端登录失败', icon: 'none' })
      }
      // 首屏只用这一次云调用。红点和另一个 Tab 等它回来再预热
      setTimeout(() => {
        if (isForum) repo.prefetchWallHome().catch(() => {})
        inbox.refresh(true).catch(() => {})
      }, 700)
      return result
    }
    store.ensureInit()
    this.globalData.user = store.getUser()
    this.globalData.speakGate = store.getSpeakGate()
    inbox.refresh(true).catch(() => {})
    return { ok: true, user: this.globalData.user, speakGate: this.globalData.speakGate }
  },

  globalData: {
    user: null,
    speakGate: null,
    ready: null
  }
})
