const repo = require('../../utils/repo')

const DEFAULT_NICKNAME = '黎安话事'

function normalizeNickname(raw) {
  return String(raw || '')
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20)
}

Page({
  data: {
    nickname: '',
    original: '',
    canSave: false,
    saving: false
  },

  async onLoad() {
    await (getApp().globalData.ready || Promise.resolve())
    const user = (await repo.getUser()) || {}
    const nickname = normalizeNickname(user.nickname) || DEFAULT_NICKNAME
    this.setData({
      nickname,
      original: nickname,
      canSave: false
    })
  },

  onInput(e) {
    const value = e.detail.value
    // 点键盘上的「使用微信昵称」时，微信会先回一个空串。写回去会把昵称清掉。
    if (!value) return
    const nickname = String(value).slice(0, 20)
    this.setData({ nickname })
    this.updateCanSave(nickname)
  },

  onNicknameBlur(e) {
    const next = normalizeNickname(e.detail && e.detail.value)
    if (!next) return
    this.setData({ nickname: next })
    this.updateCanSave(next)
  },

  onNicknameReview(e) {
    const detail = (e && e.detail) || {}
    if (detail.pass === false && !detail.timeout) {
      wx.showToast({ title: '这个昵称不可用', icon: 'none' })
    }
  },

  updateCanSave(raw) {
    const next = normalizeNickname(raw)
    const original = normalizeNickname(this.data.original)
    this.setData({ canSave: !!next && next !== original })
  },

  async onSave() {
    if (this.data.saving) return
    const nickname = normalizeNickname(this.data.nickname) || DEFAULT_NICKNAME
    const original = normalizeNickname(this.data.original)
    if (nickname === original) {
      wx.navigateBack()
      return
    }

    this.setData({ saving: true, nickname })
    try {
      const result = await repo.updateUser({ nickname })
      if (!result.ok) {
        wx.showToast({ title: result.message || '保存失败', icon: 'none' })
        return
      }
      const app = getApp()
      app.globalData.user = result.user
      wx.showToast({ title: '昵称已更新', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } finally {
      this.setData({ saving: false })
    }
  }
})
