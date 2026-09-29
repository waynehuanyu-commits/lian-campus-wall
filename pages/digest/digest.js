const repo = require('../../utils/repo')
const share = require('../../utils/share')
const track = require('../../utils/track')

Page({
  data: {
    digest: null
  },

  async onLoad(query) {
    this.digestId = query.id || ''
    this.openTo = query.to || ''
    this.fromShare = query.from || ''
    share.enableMenus()
    await this.refresh()
    if (this.openTo) {
      setTimeout(() => this.goContent(this.openTo), 60)
    }
  },

  async onShow() {
    share.enableMenus()
    if (this._ready) this.refresh()
    this._ready = true
  },

  async refresh() {
    const digest = await repo.getDigest(this.digestId || '')
    this.setData({
      digest: digest
        ? {
          ...digest,
          pagepath: digest.pagepath || `pages/digest/digest?id=${digest.id}`
        }
        : null
    })
  },

  goDetail(e) {
    const { id, type } = e.currentTarget.dataset
    this.openDetail(type, id)
  },

  goContent(contentId) {
    const digest = this.data.digest
    if (!digest) return
    const item = (digest.items || []).find((one) => one.contentId === contentId)
    if (!item) return
    this.openDetail(item.contentType, item.contentId)
  },

  openDetail(type, id) {
    if (!id) return
    if (type === 'forum') {
      wx.navigateTo({ url: `/pages/forum-detail/forum-detail?id=${id}` })
      return
    }
    wx.navigateTo({ url: `/pages/wall-detail/wall-detail?id=${id}` })
  },

  onShareAppMessage() {
    const digest = this.data.digest || {}
    const card = share.digestCard(digest)
    track.share({
      channel: 'app_message',
      surface: 'digest',
      contentType: 'digest',
      contentId: digest.id || this.digestId || ''
    })
    return card.appMessage
  },

  onShareTimeline() {
    const digest = this.data.digest || {}
    const card = share.digestCard(digest)
    track.share({
      channel: 'timeline',
      surface: 'digest',
      contentType: 'digest',
      contentId: digest.id || this.digestId || ''
    })
    return card.timeline
  }
})
