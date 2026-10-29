const store = require('../../utils/store')
const repo = require('../../utils/repo')
const auth = require('../../utils/auth')
const track = require('../../utils/track')
const media = require('../../utils/media')
const publishGuard = require('../../utils/publish-guard')

const BOARD_META = {
  '二手闲置流转': {
    titleLabel: '物品名称',
    titlePlaceholder: '例如：几乎全新的《深入理解计算机系统》',
    extraLabel: '价格',
    extraPlaceholder: '例如：45 元 / 可小刀 / 面议',
    contentPlaceholder: '成色、入手渠道、面交地点等',
    maxImages: 9
  },
  '出行拼车': {
    titleLabel: '标题',
    titlePlaceholder: '例如：周五下午去汉口火车站',
    contentPlaceholder: '费用分摊、途经点、行李空间等',
    maxImages: 3
  },
  '拼单互助': {
    titleLabel: '拼什么',
    titlePlaceholder: '例如：拼一单水果捞，差 2 人起送',
    extraLabel: '人数 / 截止时间',
    extraPlaceholder: '例如：满 3 人 · 今天下午',
    contentPlaceholder: '店铺、配送地址、怎么分摊',
    maxImages: 3
  },
  '求物求助': {
    titleLabel: '需要什么',
    titlePlaceholder: '例如：求借一台科学计算器',
    extraLabel: '紧急程度 / 时限',
    extraPlaceholder: '例如：本周三前',
    contentPlaceholder: '用途、归还时间、取还地点等',
    maxImages: 3
  },
  '失物招领': {
    titleLabel: '物品名称',
    titlePlaceholder: '例如：黑色钱包 / 校园卡',
    extraLabel: '地点 / 时间',
    extraPlaceholder: '例如：一食堂门口 · 今早',
    contentPlaceholder: '特征、拾到或丢失时间地点等',
    maxImages: 6
  }
}

Page({
  data: {
    boards: store.WALL_BOARDS,
    tag: store.WALL_BOARDS[0],
    isRide: false,
    title: '',
    extraField: '',
    extra: '',
    routeFrom: '',
    routeTo: '',
    departTime: '',
    content: '',
    images: [],
    allowContact: true,
    contactType: 'wechat',
    contactValue: '',
    anonymous: false,
    submitting: false,
    published: false,
    blocked: false,
    blockTitle: '',
    blockDesc: '',
    blockAction: '',
    titleLabel: '',
    titlePlaceholder: '',
    extraLabel: '',
    extraPlaceholder: '',
    contentPlaceholder: '',
    maxImages: 9
  },

  onLoad() {
    wx.redirectTo({ url: '/pages/forum-publish/forum-publish' })
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
    track.pageView('wall_publish', { tag: this.data.tag })
  },

  applyBoard(tag) {
    const meta = BOARD_META[tag] || BOARD_META['二手闲置流转']
    this.setData({
      tag,
      isRide: tag === '出行拼车',
      allowContact: true,
      titleLabel: meta.titleLabel || '',
      titlePlaceholder: meta.titlePlaceholder || '',
      extraLabel: meta.extraLabel || '',
      extraPlaceholder: meta.extraPlaceholder || '',
      contentPlaceholder: meta.contentPlaceholder || '',
      maxImages: meta.maxImages || 3,
      images: this.data.images.slice(0, meta.maxImages || 3)
    })
  },

  goAuth() {
    auth.goSchoolAuth()
  },

  goLogin() {
    auth.goLogin()
  },

  onTagTap(e) {
    const tag = e.currentTarget.dataset.name
    track.publishTagSelect({ surface: 'wall_publish', contentType: 'wall', tag, from: this.data.tag })
    this.applyBoard(tag)
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value })
  },

  onExtraFieldInput(e) {
    this.setData({ extraField: e.detail.value })
  },

  onExtraInput(e) {
    this.setData({ extra: e.detail.value })
  },

  onRouteFromInput(e) {
    this.setData({ routeFrom: e.detail.value })
  },

  onRouteToInput(e) {
    this.setData({ routeTo: e.detail.value })
  },

  onDepartTimeInput(e) {
    this.setData({ departTime: e.detail.value })
  },

  onContentInput(e) {
    this.setData({ content: e.detail.value })
  },

  onContactInput(e) {
    this.setData({ contactValue: e.detail.value })
  },

  onAnonymousChange(e) {
    this.setData({ anonymous: e.detail.value })
  },

  chooseImages() {
    const remain = this.data.maxImages - this.data.images.length
    media.chooseImages({
      count: remain,
      existing: this.data.images
    }).then((images) => {
      this.setData({ images: images.slice(0, this.data.maxImages) })
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
    const { tag, isRide, title, extraField, extra, routeFrom, routeTo, departTime, content, images, contactValue, anonymous } = this.data
    const text = (content || '').trim()
    const titleText = (title || '').trim()

    if (!titleText) {
      wx.showToast({ title: '请填写标题', icon: 'none' })
      return
    }

    const contact = store.validateWallContact('wechat', contactValue, tag)
    if (!contact.ok) {
      wx.showToast({ title: contact.message, icon: 'none' })
      return
    }

    this._submitLock = true
    this.setData({ submitting: true })
    const draft = {
      tag,
      title: titleText,
      price: tag === '二手闲置流转' ? extraField : '',
      routeFrom: isRide ? routeFrom : '',
      routeTo: isRide ? routeTo : '',
      departTime: isRide ? departTime : '',
      extra: isRide || tag !== '二手闲置流转' ? (isRide ? extra : extraField) : '',
      content: text,
      images,
      contactType: contact.contactType,
      contactValue: contact.contactValue,
      anonymous
    }
    const submitId = publishGuard.submitIdFor(this, draft)
    const result = await publishGuard.runPublish(() => repo.createWallPost({ ...draft, submitId }))
    if (!result.ok) {
      this._submitLock = false
      this.setData({ submitting: false })
    } else {
      this.setData({ submitting: false, published: true })
    }
    if (auth.showActionError(result)) {
      track.publishFail({
        surface: 'wall_publish',
        contentType: 'wall',
        tag,
        reason: (result && result.code) || 'action_error',
        message: (result && result.message) || ''
      })
      return
    }
    track.publishSuccess({
      surface: 'wall_publish',
      contentType: 'wall',
      contentId: (result && result.post && result.post.id) || '',
      tag,
      anonymous: !!anonymous,
      imageCount: (images || []).length
    })
    const status = result.post && result.post.reviewStatus
    if (status && status !== 'approved') {
      wx.showToast({ title: result.message || '已提交，审核通过后公开', icon: 'none', duration: 2500 })
      auth.safeBack(800)
      return
    }
    const flushed = result.distribution && result.distribution.flushed
    const progress = (result.distribution && (result.distribution.progress || result.distribution)) || {}
    wx.showToast({
      title: flushed ? '已发布，满10条将自动群发' : `已发布，汇总 ${progress.count || 0}/${progress.size || 10}`,
      icon: 'none'
    })
    auth.safeBack(450)
  }
})
