const repo = require('../../utils/repo')
const track = require('../../utils/track')
const share = require('../../utils/share')
const { formatTime } = require('../../utils/util')

const REVIEW_LABELS = {
  pending: '审核中，通过后会出现在黎安攻略',
  rejected: '未通过审核',
  offline: '已下线'
}

Page({
  data: {
    loading: true,
    guide: null,
    error: ''
  },

  onLoad(options) {
    this.id = (options && options.id) || ''
    share.enableMenus()
    this.load()
  },

  async load() {
    const result = await repo.getGuide(this.id)
    if (!result || result.ok === false || !result.guide) {
      this.setData({ loading: false, guide: null, error: (result && result.message) || '攻略不存在' })
      return
    }
    const guide = result.guide
    this.setData({
      loading: false,
      guide: {
        ...guide,
        timeText: formatTime(guide.publishedAt),
        reviewLabel: REVIEW_LABELS[guide.reviewStatus] || '审核中'
      }
    })
    track.pageView('guide_detail', { contentId: guide.id, category: guide.category })
  },

  onShareAppMessage() {
    track.share({ channel: 'app_message', surface: 'guide_detail', contentId: this.id })
    return share.guideCard({ ...(this.data.guide || {}), id: this.id }).appMessage
  },

  onShareTimeline() {
    track.share({ channel: 'timeline', surface: 'guide_detail', contentId: this.id })
    return share.guideCard({ ...(this.data.guide || {}), id: this.id }).timeline
  }
})
