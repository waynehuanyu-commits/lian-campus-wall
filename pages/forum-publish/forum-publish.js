const store = require('../../utils/store')
const repo = require('../../utils/repo')
const auth = require('../../utils/auth')
const track = require('../../utils/track')
const media = require('../../utils/media')
const publishGuard = require('../../utils/publish-guard')

Page({
  data: {
    topics: store.HOME_TOPICS.concat([store.OTHER_TOPIC]),
    otherTopic: store.OTHER_TOPIC,
    tagMode: 'preset',
    tag: store.DEFAULT_HOME_TAG,
    customTag: '',
    otherFocus: false,
    title: '',
    content: '',
    images: [],
    contactValue: '',
    blocked: false,
    blockTitle: '',
    blockDesc: '',
    blockAction: '',
    submitting: false,
    published: false
  },

  async onShow() {
    await (getApp().globalData.ready || Promise.resolve())
    const gate = await repo.getSpeakGate({ force: true })
    let blockAction = ''
    if (gate.code === 'NEED_LOGIN') blockAction = 'login'
    else if (gate.code === 'NEED_AUTH') blockAction = 'auth'
    else if (gate.code === 'NEED_PHONE') blockAction = 'phone'
    this.setData({
      blocked: !gate.ok,
      blockTitle: gate.title || (blockAction === 'login' ? '开通发言' : '发布前请先认证学校'),
      blockDesc: gate.message || (blockAction === 'login'
        ? '浏览开放。发帖需要先完成登录与学校认证。'
        : '发帖还需要填写学校信息。'),
      blockAction
    })
    track.pageView('forum_publish', { category: this.currentTag() })
  },

  cleanTag(value) {
    return String(value || '').replace(/^[#＃]+/, '').replace(/\s+/g, '').trim().slice(0, 8)
  },

  currentTag() {
    if (this.data.tagMode === 'other') return this.cleanTag(this.data.customTag)
    return this.data.tag || store.DEFAULT_HOME_TAG
  },

  goAuth() {
    auth.goSchoolAuth()
  },

  goLogin() {
    auth.goLogin()
  },

  onTopicTap(e) {
    const tag = e.currentTarget.dataset.name
    if (tag === store.OTHER_TOPIC) {
      track.publishTagSelect({
        surface: 'forum_publish',
        contentType: 'forum',
        category: store.OTHER_TOPIC,
        from: this.currentTag()
      })
      this.setData({ tagMode: 'other', otherFocus: true })
      return
    }
    track.publishTagSelect({
      surface: 'forum_publish',
      contentType: 'forum',
      category: tag,
      from: this.currentTag()
    })
    this.setData({ tagMode: 'preset', tag, otherFocus: false })
  },

  onCustomInput(e) {
    this.setData({ customTag: e.detail.value })
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value })
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value })
  },

  onContactInput(e) {
    this.setData({ contactValue: e.detail.value })
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
    if (this._submitLock || this.data.submitting || this.data.published || !auth.ensureCanSpeak()) return
    const title = this.data.title.trim()
    const content = this.data.content.trim()
    if (!title && !content && !(this.data.images || []).length) {
      wx.showToast({ title: '请填写标题或正文', icon: 'none' })
      return
    }
    const customTag = this.cleanTag(this.data.customTag)
    if (this.data.tagMode === 'other' && !customTag) {
      wx.showToast({ title: '请输入话题', icon: 'none' })
      return
    }
    if (this.data.tagMode === 'other' && store.HOME_TOPICS.indexOf(customTag) >= 0) {
      wx.showToast({ title: '这个话题已在上面，请直接选择', icon: 'none' })
      return
    }
    const tag = this.data.tagMode === 'other'
      ? customTag
      : (this.data.tag || store.DEFAULT_HOME_TAG)
    const contact = store.validateWallContact
      ? store.validateWallContact('wechat', this.data.contactValue, tag)
      : { ok: true, contactType: '', contactValue: '' }
    if (contact && contact.ok === false) {
      wx.showToast({ title: contact.message || '微信号格式不对', icon: 'none' })
      return
    }
    this._submitLock = true
    this.setData({ submitting: true })
    const draft = {
      tag,
      category: tag,
      title,
      content,
      images: this.data.images,
      contactType: (contact && contact.contactType) || '',
      contactValue: (contact && contact.contactValue) || ''
    }
    const submitId = publishGuard.submitIdFor(this, draft)
    const result = await publishGuard.runPublish(() => repo.createForumPost({ ...draft, submitId }))
    if (!result.ok) {
      // 失败：解锁、保留草稿；内容不改直接重试会沿用同一个 submitId
      this._submitLock = false
      this.setData({ submitting: false })
    } else {
      // 成功：保持锁定直到离开页面，避免返回前再点一次
      this.setData({ submitting: false, published: true })
    }
    if (auth.showActionError(result)) {
      track.publishFail({
        surface: 'forum_publish',
        contentType: 'forum',
        category: tag,
        reason: (result && result.code) || 'action_error',
        message: (result && result.message) || ''
      })
      return
    }
    track.publishSuccess({
      surface: 'forum_publish',
      contentType: 'forum',
      contentId: (result && result.post && result.post.id) || '',
      category: tag,
      anonymous: false,
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
