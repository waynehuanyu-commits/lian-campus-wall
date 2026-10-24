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
    placeholder: '填写昵称',
    original: '',
    saving: false
  },

  async onLoad() {
    await (getApp().globalData.ready || Promise.resolve())
    const user = (await repo.getUser()) || {}
    const original = normalizeNickname(user.nickname)
    this.setData({
      original,
      placeholder: original && original !== DEFAULT_NICKNAME ? original : '填写昵称'
    })
  },

  onNicknameReview(e) {
    const detail = (e && e.detail) || {}
    if (detail.pass === false && !detail.timeout) {
      wx.showToast({ title: '这个昵称不可用', icon: 'none' })
    }
  },

  async onSave(e) {
    if (this.data.saving) return
    const fromForm = e && e.detail && e.detail.value ? e.detail.value.nickname : ''
    const nickname = normalizeNickname(fromForm)
    const original = normalizeNickname(this.data.original)
    if (!nickname) {
      wx.showToast({ title: '先填写昵称，或点键盘上的「使用微信昵称」', icon: 'none' })
      return
    }
    if (nickname === original) {
      wx.navigateBack()
      return
    }

    this.setData({ saving: true })
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
