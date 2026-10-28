const store = require('../../utils/store')
const repo = require('../../utils/repo')
const auth = require('../../utils/auth')
const track = require('../../utils/track')
const media = require('../../utils/media')

const TONE_COUNT = 5
const SUMMARY_SIZE = 60

Page({
  data: {
    categories: store.GUIDE_CATEGORIES,
    category: store.GUIDE_CATEGORIES[0],
    tone: 0,
    title: '',
    content: '',
    summary: '',
    images: [],
    blocked: false,
    blockTitle: '',
    blockDesc: '',
    blockAction: '',
    submitting: false
  },

  onLoad(options) {
    this.wanted = decodeURIComponent((options && options.category) || '')
    if (this.wanted && this.data.categories.indexOf(this.wanted) >= 0) this.pickCategory(this.wanted)
    this.loadCategories()
  },

  // 分类以运营后台为准；拿不到时沿用包内默认分类
  async loadCategories() {
    const result = await repo.getGuideCategories()
    const categories = (result && result.ok && result.categories && result.categories.length)
      ? result.categories
      : null
    if (!categories) return
    const current = categories.indexOf(this.data.category) >= 0 ? this.data.category : ''
    const wanted = this.wanted && categories.indexOf(this.wanted) >= 0 ? this.wanted : ''
    this.setData({ categories }, () => this.pickCategory(current || wanted || categories[0]))
  },

  async onShow() {
    await (getApp().globalData.ready || Promise.resolve())
    const gate = await repo.getSpeakGate({ force: true })
    let blockAction = ''
    if (gate.code === 'NEED_LOGIN') blockAction = 'login'
    else if (gate.code === 'NEED_AUTH') blockAction = 'auth'
    this.setData({
      blocked: !gate.ok,
      blockTitle: gate.title || (blockAction === 'login' ? '开通发言' : '投稿前请先认证学校'),
      blockDesc: gate.message || '',
      blockAction
    })
    track.pageView('guide_publish', { category: this.data.category })
  },

  goAuth() {
    auth.goSchoolAuth()
  },

  goLogin() {
    auth.goLogin()
  },

  pickCategory(category) {
    const index = Math.max(0, this.data.categories.indexOf(category))
    this.setData({ category, tone: index % TONE_COUNT })
  },

  onCategoryTap(e) {
    const category = e.currentTarget.dataset.name
    if (category) this.pickCategory(category)
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value })
  },

  onContentInput(e) {
    const content = e.detail.value
    this.setData({
      content,
      summary: String(content || '').replace(/\s+/g, ' ').trim().slice(0, SUMMARY_SIZE)
    })
  },

  chooseImages() {
    media.chooseImages({
      count: 9,
      existing: this.data.images
    }).then((images) => {
      this.setData({ images })
    }).catch(() => {
      wx.showToast({ title: '选图失败', icon: 'none' })
    })
  },

  removeImage(e) {
    const images = this.data.images.slice()
    images.splice(e.currentTarget.dataset.index, 1)
    this.setData({ images })
  },

  previewImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const urls = this.data.images || []
    media.previewImages(urls[index] || urls[0], urls)
  },

  async onSubmit() {
    if (this._submitLock || this.data.submitting || !auth.ensureCanSpeak()) return
    const title = this.data.title.trim()
    const content = this.data.content.trim()
    if (!title) {
      wx.showToast({ title: '请填写标题', icon: 'none' })
      return
    }
    if (content.length < 10) {
      wx.showToast({ title: '正文至少写 10 个字', icon: 'none' })
      return
    }
    this._submitLock = true
    this.setData({ submitting: true })
    let result
    try {
      result = await repo.submitGuide({
        category: this.data.category,
        title,
        content,
        images: this.data.images
      })
    } catch (err) {
      // 图片上传失败等异常：留在当前页，内容不丢
      result = { ok: false, message: (err && (err.message || err.errMsg)) || '投稿失败，请稍后再试' }
    } finally {
      this._submitLock = false
      this.setData({ submitting: false })
    }
    if (auth.showActionError(result)) {
      track.publishFail({
        surface: 'guide_publish',
        contentType: 'guide',
        category: this.data.category,
        reason: (result && result.code) || 'action_error',
        message: (result && result.message) || ''
      })
      return
    }
    track.publishSuccess({
      surface: 'guide_publish',
      contentType: 'guide',
      contentId: (result && result.guide && result.guide.id) || '',
      category: this.data.category,
      imageCount: (this.data.images || []).length
    })
    wx.showToast({ title: result.message || '已投稿，审核通过后展示', icon: 'none', duration: 2500 })
    auth.safeBack(900)
  }
})
