const config = require('./utils/config')
const store = require('./utils/store')
const repo = require('./utils/repo')
const track = require('./utils/track')
const inbox = require('./utils/inbox')

App({
  onLaunch(options) {
    this.globalData.entryPath = (options && options.path) || ''
    this.globalData.ready = this.init()
  },

  onShow() {},

  onHide() {
    track.flush().catch(() => {})
  },

  async init() {
    if (config.useCloud) {
      wx.cloud.init({
        env: config.cloudEnvId,
        traceUser: true
      })
      const path = this.globalData.entryPath || ''
      const isForum = !path || path === 'pages/forum/forum'
      const isWall = path === 'pages/wall/wall'
      if (!isForum && !isWall) {
        setTimeout(() => inbox.refresh(true).catch(() => {}), 1200)
        return { ok: true }
      }
      const forumPeek = isForum ? repo.peekList('forum', repo.HOME_FORUM_QUERY) : null
      const wallPeek = isWall ? repo.peekList('wall', repo.HOME_WALL_QUERY) : null
      const result = await repo.bootstrap({
        includeForum: isForum && !(forumPeek && forumPeek.fresh),
        includeWall: isWall && !(wallPeek && wallPeek.fresh)
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
