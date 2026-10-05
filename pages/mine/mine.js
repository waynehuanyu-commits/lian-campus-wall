const store = require('../../utils/store')
const repo = require('../../utils/repo')
const track = require('../../utils/track')
const inbox = require('../../utils/inbox')
const media = require('../../utils/media')

const DEFAULT_AVATAR = '/images/avatar-default.png'
const AVATAR_VIEW_KEY = 'cw_mine_avatar_v1'
const AVATAR_VIEW_TTL = 7 * 24 * 60 * 60 * 1000

Page({
  data: {
    user: {},
    schoolText: '',
    accountTip: '',
    accountStatus: 'active',
    studentAuthText: '',
    studentAuthAction: '去认证',
    studentAuthBadge: '',
    studentAuthBadgeClass: '',
    engageUnread: 0,
    messageUnread: 0,
    avatarSrc: DEFAULT_AVATAR,
    avatarSheet: false
  },

  async onShow() {
    const app = getApp()
    const cachedUser = app && app.globalData && app.globalData.user
    if (cachedUser) this.paint(cachedUser, app.globalData.speakGate)
    try {
      await (app.globalData.ready || Promise.resolve())
    } catch (e) {
      // 登录失败也先把本地资料画出来
    }
    track.pageView('mine')
    this.refresh()
    this.refreshBadges()
  },

  async refreshBadges() {
    const badges = await inbox.refresh()
    this.setData({
      engageUnread: (Number(badges.unreadLikes) || 0) + (Number(badges.unreadComments) || 0),
      messageUnread: Number(badges.unreadMessages) || 0
    })
  },

  readAvatarViewCache(userId, saved) {
    try {
      const row = wx.getStorageSync(AVATAR_VIEW_KEY)
      if (!row || row.userId !== userId || row.saved !== saved) return ''
      if (Date.now() - (row.at || 0) > AVATAR_VIEW_TTL) return ''
      const src = String(row.src || '')
      if (!src || src === DEFAULT_AVATAR) return ''
      if (src.startsWith('wxfile://') || src.startsWith('http://tmp') || src.startsWith('https://tmp')) return ''
      return src
    } catch (e) {
      return ''
    }
  },

  writeAvatarViewCache(userId, saved, src) {
    if (!userId || !saved || !src || src === DEFAULT_AVATAR) return
    if (saved === DEFAULT_AVATAR) return
    if (src.startsWith('http://tmp') || src.startsWith('https://tmp')) return
    try {
      wx.setStorage({
        key: AVATAR_VIEW_KEY,
        data: { userId, saved, src, at: Date.now() }
      })
    } catch (e) {
      // ignore
    }
  },

  paint(user, gate) {
    const status = (user && user.studentAuthStatus) || 'none'
    const savedAvatar = (user && user.avatar) || DEFAULT_AVATAR
    const preview = this._avatarPreview && this._avatarPreview.id === savedAvatar ? this._avatarPreview.src : ''
    const cached = user && user.id ? this.readAvatarViewCache(user.id, savedAvatar) : ''
    const nextGate = gate || {}
    this.setData({
      avatarSrc: preview || cached || this.data.avatarSrc || DEFAULT_AVATAR,
      user: {
        ...(user || {}),
        avatar: savedAvatar
      },
      schoolText: store.formatSchool(user || {}) || '已认证',
      accountTip: nextGate.ok ? '' : (nextGate.message || ''),
      accountStatus: (user && user.status) || 'active',
      studentAuthText: store.studentAuthStatusText(status),
      studentAuthAction: status === 'approved' ? '查看' : (status === 'pending' ? '审核中' : '去认证'),
      studentAuthBadge: status === 'approved' ? '学生已认证' : (status === 'pending' ? '认证审核中' : ''),
      studentAuthBadgeClass: status === 'approved' ? 'ok' : ''
    })
  },

  async refresh() {
    const user = (await repo.getUser({ force: true })) || {}
    const gate = await repo.getSpeakGate()
    this.paint(user, gate)
    const savedAvatar = user.avatar || DEFAULT_AVATAR
    const preview = this._avatarPreview && this._avatarPreview.id === savedAvatar ? this._avatarPreview.src : ''
    const avatarSrc = await this.avatarForView(user.id, savedAvatar, preview)
    if (avatarSrc) this.setData({ avatarSrc })
  },

  isLocalAvatar(value) {
    const raw = String(value || '')
    return raw.startsWith('wxfile://')
      || raw.startsWith('http://tmp')
      || raw.startsWith('https://tmp')
      || raw.startsWith('/images/')
  },

  async avatarForView(userId, saved, preview) {
    if (preview && this.isLocalAvatar(preview)) return preview
    const raw = String(saved || '').trim()
    if (!raw || raw === DEFAULT_AVATAR) return DEFAULT_AVATAR
    if (this.isLocalAvatar(raw)) return raw
    const cached = userId ? this.readAvatarViewCache(userId, raw) : ''
    const resolved = await media.toLocal(raw)
    const src = resolved && resolved !== raw && !/^cloud:\/\//.test(resolved)
      ? resolved
      : (resolved && /^https:\/\//i.test(resolved) ? resolved : '')
    if (src) {
      if (userId) this.writeAvatarViewCache(userId, raw, src)
      return src
    }
    if (cached) return cached
    if (/^https:\/\//i.test(raw)) return raw
    return DEFAULT_AVATAR
  },

  async onAvatarError() {
    if (this.data.avatarSrc === DEFAULT_AVATAR) return
    const user = this.data.user || {}
    const saved = user.avatar || DEFAULT_AVATAR
    const preview = this._avatarPreview && this._avatarPreview.src
    if (preview && preview !== this.data.avatarSrc && this.isLocalAvatar(preview)) {
      this.setData({ avatarSrc: preview })
      return
    }
    const cached = user.id ? this.readAvatarViewCache(user.id, saved) : ''
    if (cached && cached !== this.data.avatarSrc) {
      this.setData({ avatarSrc: cached })
      return
    }
    const retry = await this.avatarForView(user.id, saved, preview)
    if (retry && retry !== DEFAULT_AVATAR && retry !== this.data.avatarSrc) {
      this.setData({ avatarSrc: retry })
      return
    }
    this.setData({ avatarSrc: DEFAULT_AVATAR })
  },

  noop() {},

  openAvatarSheet() {
    this.setData({ avatarSheet: true })
  },

  closeAvatarSheet() {
    this.setData({ avatarSheet: false })
  },

  onChooseAvatar(e) {
    const avatar = e.detail && e.detail.avatarUrl
    this.setData({ avatarSheet: false })
    if (!avatar) {
      wx.showModal({
        title: '没有拿到微信头像',
        content: '可以改用「从相册选择」或「拍照」。',
        showCancel: false,
        confirmColor: '#2F7DFF'
      })
      return
    }
    this.applyAvatar(avatar)
  },

  onPickPhoto(e) {
    const source = e.currentTarget.dataset.source === 'camera' ? 'camera' : 'album'
    this.setData({ avatarSheet: false })
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [source],
      sizeType: ['compressed'],
      success: (res) => {
        const file = (res.tempFiles || [])[0] || {}
        if (file.tempFilePath) this.applyAvatar(file.tempFilePath)
      },
      fail: (err) => {
        const raw = String((err && err.errMsg) || '')
        if (/cancel/i.test(raw)) return
        const content = /privacy|隐私|api scope/i.test(raw)
          ? '请先同意隐私保护提示，再选一张照片。'
          : (raw || '请允许微信访问相册后再试')
        wx.showModal({ title: '没有打开相册', content, showCancel: false, confirmColor: '#2F7DFF' })
      }
    })
  },

  async applyAvatar(avatar) {
    const previousSrc = this.data.avatarSrc
    this.setData({ avatarSrc: avatar })
    wx.showLoading({ title: '上传中', mask: true })
    let nextAvatar = avatar
    try {
      const uploaded = await repo.uploadImages([avatar], 'avatars')
      nextAvatar = uploaded[0] || avatar
      if (!String(nextAvatar).startsWith('cloud://') && !String(nextAvatar).startsWith('/images/')) {
        throw new Error('头像上传失败，请重试')
      }
    } catch (err) {
      wx.hideLoading()
      this.setData({ avatarSrc: previousSrc || DEFAULT_AVATAR })
      const raw = String((err && (err.errMsg || err.message)) || '')
      const content = /451|欠费|arrears/i.test(raw)
        ? '云存储现在存不了图，头像换不上去。微信云开发充值之后再试一次。'
        : (raw || '头像上传失败')
      wx.showModal({ title: '头像没换上', content, showCancel: false, confirmColor: '#2F7DFF' })
      return
    }
    const result = await repo.updateUser({ avatar: nextAvatar })
    wx.hideLoading()
    if (!result || !result.ok) {
      this.setData({ avatarSrc: previousSrc || DEFAULT_AVATAR })
      wx.showModal({
        title: '头像没换上',
        content: (result && result.message) || '头像保存失败',
        showCancel: false,
        confirmColor: '#2F7DFF'
      })
      return
    }
    const saved = (result.user && result.user.avatar) || nextAvatar
    this._avatarPreview = { id: saved, src: avatar }
    const user = result.user || this.data.user
    if (user && user.id) this.writeAvatarViewCache(user.id, saved, avatar)
    this.setData({
      avatarSrc: avatar,
      user: {
        ...user,
        avatar: saved
      }
    })
    setTimeout(() => wx.showToast({ title: '头像已更新', icon: 'success' }), 200)
  },

  async onBioBlur(e) {
    const bio = (e.detail.value || '').trim() || '在这里遇见有趣的灵魂'
    const result = await repo.updateUser({ bio })
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: 'none' })
      return
    }
    this.setData({ user: result.user })
  },

  async onShowSchoolTagChange(e) {
    const enabled = !!(e.detail && e.detail.value)
    const result = await repo.updateUser({ showSchoolTag: enabled })
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: 'none' })
      this.setData({ user: { ...this.data.user, showSchoolTag: !enabled } })
      return
    }
    track.schoolTagToggle({ surface: 'mine', enabled })
    this.setData({ user: result.user })
    wx.showToast({
      title: enabled ? '已展示学校标签' : '已隐藏学校标签',
      icon: 'none'
    })
  },

  async enterOfficial() {
    wx.showLoading({ title: '登录中', mask: true })
    let result
    try {
      result = await repo.enterOfficial()
    } catch (err) {
      result = { ok: false, message: (err && err.message) || '登录失败' }
    }
    wx.hideLoading()
    if (!result || !result.ok) {
      const raw = (result && result.message) || '登录失败'
      const content = raw.indexOf('未知操作') >= 0
        ? '云函数 userApi 还是旧的，登录没有生效。请在微信开发者工具里上传并部署 userApi，然后再点一次。'
        : raw
      wx.showModal({ title: '登录失败', content, showCancel: false, confirmColor: '#2F7DFF' })
      return
    }
    await this.refresh()
    wx.showModal({ title: '已登录', content: '现在发帖和评论会显示为黎安校园墙。', showCancel: false, confirmColor: '#2F7DFF' })
  },

  async leaveOfficial() {
    wx.showLoading({ title: '退出中', mask: true })
    let result
    try {
      result = await repo.leaveOfficial()
    } catch (err) {
      result = { ok: false, message: (err && err.message) || '退出失败' }
    }
    wx.hideLoading()
    if (!result || !result.ok) {
      wx.showModal({
        title: '退出失败',
        content: (result && result.message) || '退出失败',
        showCancel: false,
        confirmColor: '#2F7DFF'
      })
      return
    }
    await this.refresh()
  },

  goEditNickname() {
    wx.navigateTo({ url: '/pages/edit-nickname/edit-nickname' })
  },

  copyAccountId() {
    const id = this.data.user && this.data.user.id
    if (!id) return
    wx.setClipboardData({ data: id })
  },

  goSchool() {
    wx.navigateTo({ url: '/pages/school-auth/school-auth' })
  },

  goMyPosts() {
    wx.navigateTo({ url: '/pages/my-posts/my-posts' })
  },

  goMyEngage() {
    wx.navigateTo({ url: '/pages/my-engage/my-engage' })
  },

  goMyMessages() {
    wx.navigateTo({ url: '/pages/my-messages/my-messages' })
  },

  goAbout() {
    wx.navigateTo({ url: '/pages/about/about' })
  }
})
