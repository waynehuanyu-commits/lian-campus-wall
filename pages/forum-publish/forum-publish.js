const store = require('../../utils/store')
const repo = require('../../utils/repo')
const auth = require('../../utils/auth')
const track = require('../../utils/track')
const media = require('../../utils/media')

Page({
  data: {
    categories: store.FORUM_CATEGORIES,
    category: store.FORUM_CATEGORIES[0],
    title: '',
    content: '',
    images: [],
    anonymous: false,
    blocked: false,
    blockTitle: '',
    blockDesc: '',
    blockAction: '',
    submitting: false
  },

  async onShow() {
    await (getApp().globalData.ready || Promise.resolve())
    const gate = await repo.getSpeakGate({ force: true })
    let blockAction = ''
    if (gate.code === 'NEED_LOGIN') blockAction = 'login'
    else if (gate.code === 'NEED_AUTH') blockAction = 'auth'
    this.setData({
      blocked: !gate.ok,
      blockTitle: gate.title || (blockAction === 'login' ? '开通发言' : '发布前请先认证学校'),
      blockDesc: gate.message || (blockAction === 'login'
        ? '浏览开放。发帖需要先完成登录与学校认证。'
        : '发帖还需要填写学校信息。'),
      blockAction
    })
    track.pageView('forum_publish', { category: this.data.category })
  },

  goAuth() {
    auth.goSchoolAuth()
  },

  goLogin() {
    auth.goLogin()
  },

  onCategoryTap(e) {
    const category = e.currentTarget.dataset.name
    track.publishTagSelect({
      surface: 'forum_publish',
      contentType: 'forum',
      category,
      from: this.data.category
    })
    this.setData({ category })
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value })
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value })
  },

  onAnonymousChange(e) {
    this.setData({ anonymous: e.detail.value })
  },

  chooseImages() {
    const remain = 9 - this.data.images.length
    media.chooseImages({
      count: remain,
      existing: this.data.images
    }).then((images) => {
      this.setData({ images: images.slice(0, 9) })
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
    if (this.data.submitting || !auth.ensureCanSpeak()) return
    const title = this.data.title.trim()
    const content = this.data.content.trim()
    if (!title) {
      wx.showToast({ title: '请填写标题', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    const result = await repo.createForumPost({
      category: this.data.category,
      title,
      content,
      images: this.data.images,
      anonymous: this.data.anonymous
    })
    this.setData({ submitting: false })
    if (auth.showActionError(result)) {
      track.publishFail({
        surface: 'forum_publish',
        contentType: 'forum',
        category: this.data.category,
        reason: (result && result.code) || 'action_error',
        message: (result && result.message) || ''
      })
      return
    }
    track.publishSuccess({
      surface: 'forum_publish',
      contentType: 'forum',
      contentId: (result && result.post && result.post.id) || '',
      category: this.data.category,
      anonymous: !!this.data.anonymous,
      imageCount: (this.data.images || []).length
    })
    const status = result.post && result.post.reviewStatus
    wx.showToast({
      title: status && status !== 'approved' ? (result.message || '已提交，审核通过后公开') : '发布成功',
      icon: status && status !== 'approved' ? 'none' : 'success',
      duration: status && status !== 'approved' ? 2500 : 1500
    })
    auth.safeBack(status && status !== 'approved' ? 800 : 450)
  }
})
