const repo = require('../../utils/repo')
const store = require('../../utils/store')
const auth = require('../../utils/auth')
const contact = require('../../utils/contact')
const track = require('../../utils/track')
const share = require('../../utils/share')
const userNav = require('../../utils/user')
const media = require('../../utils/media')
const { flattenCommentThread, COMMENT_IMAGE_MAX } = require('../../utils/comments')
const { formatTime } = require('../../utils/util')

Page({
  data: {
    id: '',
    post: null,
    comments: [],
    draft: '',
    draftImages: [],
    replyTo: null,
    draftPlaceholder: '留个言…',
    submitting: false,
    canSpeak: false,
    speakCode: '',
    speakMessage: '',
    dealStatusOptions: store.WALL_DEAL_STATUSES,
    contactSheetVisible: false,
    contactSheet: {
      label: '',
      value: '',
      type: ''
    },
    contactRevealed: false,
    feedbackSheetVisible: false,
    feedbackReasons: store.CONTACT_FEEDBACK_REASONS,
    feedbackReason: '',
    feedbackNote: '',
    feedbackSubmitting: false,
    feedbackDone: false,
    loading: true,
    loadError: ''
  },

  async onLoad(query) {
    this.postId = query.id || ''
    this.fromShare = query.from || ''
    this.setData({ id: this.postId, loading: true, loadError: '' })
    share.enableMenus()
    await this.refresh({ trackView: true, initial: true })
    if (this.postId) {
      repo.bumpView('wall', this.postId).catch(() => {})
    }
  },

  async onShow() {
    share.enableMenus()
    if (this._ready && Date.now() - (this._shownAt || 0) > 60000) this.refresh({ soft: true })
    this._shownAt = Date.now()
    this._ready = true
  },

  async refresh(options = {}) {
    const id = this.postId || this.data.id
    const initial = !!options.initial || !this.data.post
    if (initial) this.setData({ loading: true, loadError: '' })
    try {
      const bundle = await repo.getPostBundle('wall', id)
      const post = bundle && bundle.post
      const comments = (bundle && bundle.comments) || []
      this.applyGate()
      if (!post) {
        this.setData({
          post: null,
          comments: [],
          loading: false,
          loadError: ''
        })
        return
      }
      if (options.trackView) {
        track.postView({
          surface: 'wall_detail',
          contentType: 'wall',
          contentId: id,
          tag: post.tag || '',
          dealStatus: post.dealStatus || 'open'
        })
      }
      this.setData({
        post: { ...post, timeText: formatTime(post.createdAt) },
        comments: flattenCommentThread(comments || [], formatTime),
        loading: false,
        loadError: ''
      })
    } catch (err) {
      const message = (err && err.message) || '加载失败，请下拉重试'
      this.setData({ loading: false, loadError: this.data.post ? '' : message })
      if (!this.data.post) {
        wx.showToast({ title: '加载失败', icon: 'none' })
      }
    }
  },

  applyGate() {
    repo.getSpeakGate().then((gate) => {
      const next = gate || {}
      this.setData({
        canSpeak: !!next.ok,
        speakCode: next.code || '',
        speakMessage: next.message || ''
      })
    }).catch(() => {})
  },

  async onLike() {
    const post = this.data.post
    if (!post || this._liking) return
    this._liking = true
    const nextLiked = !post.liked
    const nextCount = Math.max(0, (Number(post.likeCount) || 0) + (nextLiked ? 1 : -1))
    this.setData({ 'post.liked': nextLiked, 'post.likeCount': nextCount })
    track.like({
      surface: 'wall_detail',
      contentType: 'wall',
      contentId: this.data.id,
      tag: post.tag || ''
    })
    try {
      const liked = await repo.toggleLike('wall', this.data.id)
      if (!!liked !== nextLiked) this.refresh({ soft: true })
    } catch (err) {
      this.setData({ 'post.liked': post.liked, 'post.likeCount': post.likeCount })
    }
    this._liking = false
  },

  onAuthorTap() {
    const post = this.data.post
    if (!post) return
    userNav.openProfile({ userId: post.authorId, anonymous: !!post.anonymous })
  },

  onCommentAuthorTap(e) {
    const userId = e.currentTarget.dataset.userid
    userNav.openProfile({ userId })
  },

  onDraftInput(e) {
    this.setData({ draft: e.detail.value })
  },

  onReply(e) {
    if (!auth.ensureCanSpeak()) return
    const { id, name } = e.currentTarget.dataset
    this.setData({
      replyTo: { id, name: name || '同学' },
      draftPlaceholder: `回复 @${name || '同学'}`
    })
  },

  onDeleteComment(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showModal({
      title: '删除这条评论',
      content: '删除后不可恢复，确定吗？',
      confirmColor: '#FF6B81',
      success: async (res) => {
        if (!res.confirm) return
        const result = await repo.deleteComment(id)
        if (auth.showActionError(result)) return
        wx.showToast({ title: '已删除', icon: 'success' })
        this.refresh({ soft: true })
      }
    })
  },

  clearReply() {
    this.setData({ replyTo: null, draftPlaceholder: '留个言…' })
  },

  chooseCommentImages() {
    if (!auth.ensureCanSpeak()) return
    const remain = COMMENT_IMAGE_MAX - (this.data.draftImages || []).length
    if (remain <= 0) {
      wx.showToast({ title: `最多 ${COMMENT_IMAGE_MAX} 张图`, icon: 'none' })
      return
    }
    media.chooseImages({
      count: remain,
      existing: this.data.draftImages || []
    }).then((images) => {
      this.setData({ draftImages: images.slice(0, COMMENT_IMAGE_MAX) })
    }).catch(() => {
      wx.showToast({ title: '选图失败', icon: 'none' })
    })
  },

  removeDraftImage(e) {
    const index = e.currentTarget.dataset.index
    const draftImages = (this.data.draftImages || []).slice()
    draftImages.splice(index, 1)
    this.setData({ draftImages })
  },

  goAuth() {
    auth.goSchoolAuth()
  },

  goLogin() {
    auth.goLogin()
  },

  async onSend() {
    if (this.data.submitting || !auth.ensureCanSpeak()) return
    const content = (this.data.draft || '').trim()
    const images = this.data.draftImages || []
    if (!content && !images.length) {
      wx.showToast({ title: '写点文字或发张图吧', icon: 'none' })
      return
    }
    const replyTo = this.data.replyTo
    this.setData({ submitting: true })
    const result = await repo.addComment('wall', this.data.id, content, {
      parentId: replyTo ? replyTo.id : '',
      replyToId: replyTo ? replyTo.id : '',
      replyToName: replyTo ? replyTo.name : '',
      images
    })
    this.setData({ submitting: false })
    if (auth.showActionError(result)) return
    track.commentSuccess({
      surface: 'wall_detail',
      contentType: 'wall',
      contentId: this.data.id,
      tag: (this.data.post && this.data.post.tag) || '',
      isReply: !!replyTo,
      imageCount: images.length
    })
    this.setData({
      draft: '',
      draftImages: [],
      replyTo: null,
      draftPlaceholder: '留个言…'
    })
    this.refresh({ soft: true })
  },

  onContactTap() {
    const post = this.data.post
    if (!post) return
    if (!post.hasContact) {
      wx.showToast({ title: '发布者未留下联系方式', icon: 'none' })
      return
    }
    track.contactReveal({
      surface: 'wall_detail',
      contentType: 'wall',
      contentId: post.id,
      tag: post.tag || '',
      source: 'detail_action'
    })
    contact.openWallContact(post.id, {
      onReady: (result) => {
        this.setData({
          contactSheetVisible: true,
          contactRevealed: true,
          contactSheet: {
            label: result.contactLabel || '联系方式',
            value: result.contactValue || '',
            type: result.contactType || ''
          }
        })
      }
    })
  },

  closeContactSheet() {
    this.setData({ contactSheetVisible: false })
  },

  openFeedbackSheet() {
    if (!this.data.contactRevealed) {
      wx.showToast({ title: '请先查看微信号', icon: 'none' })
      return
    }
    if (this.data.post && this.data.post.isOwner) {
      wx.showToast({ title: '不能反馈自己的联系方式', icon: 'none' })
      return
    }
    this.setData({
      contactSheetVisible: false,
      feedbackSheetVisible: true,
      feedbackReason: this.data.feedbackReason || '',
      feedbackNote: this.data.feedbackNote || ''
    })
  },

  closeFeedbackSheet() {
    this.setData({ feedbackSheetVisible: false })
  },

  onFeedbackReason(e) {
    this.setData({ feedbackReason: e.currentTarget.dataset.id || '' })
  },

  onFeedbackNote(e) {
    this.setData({ feedbackNote: e.detail.value })
  },

  async onSubmitFeedback() {
    if (this.data.feedbackSubmitting) return
    const reason = this.data.feedbackReason
    if (!reason) {
      wx.showToast({ title: '请选择反馈类型', icon: 'none' })
      return
    }
    const note = (this.data.feedbackNote || '').trim()
    if (reason === 'other' && !note) {
      wx.showToast({ title: '请补充说明', icon: 'none' })
      return
    }
    this.setData({ feedbackSubmitting: true })
    let result
    try {
      result = await repo.submitContactFeedback(this.data.id, { reason, note })
    } finally {
      this.setData({ feedbackSubmitting: false })
    }
    if (!result || !result.ok) {
      wx.showToast({ title: (result && result.message) || '提交失败', icon: 'none' })
      return
    }
    const post = this.data.post || {}
    track.contactFeedback({
      surface: 'wall_detail',
      contentType: 'wall',
      contentId: post.id,
      tag: post.tag || '',
      reason,
      result: 'ok'
    })
    this.setData({
      feedbackSheetVisible: false,
      feedbackDone: true,
      feedbackNote: ''
    })
    wx.showToast({ title: '感谢反馈', icon: 'success' })
  },

  noop() {},

  async onCopyContact() {
    const sheet = this.data.contactSheet || {}
    await contact.copyText(sheet.value, `${sheet.label || '联系方式'}已复制`)
    this.setData({ contactSheetVisible: false })
  },

  onPin() {
    const post = this.data.post
    if (!post || !post.canManage || this._pinning) return
    this._pinning = true
    repo.pinPost('wall', post.id, !post.pinned).then((result) => {
      this._pinning = false
      if (!result || result.ok === false) {
        wx.showToast({ title: (result && result.message) || '操作失败', icon: 'none' })
        return
      }
      wx.showToast({ title: result.message || '已更新', icon: 'none' })
      this.refresh({ soft: true })
    }).catch(() => {
      this._pinning = false
      wx.showToast({ title: '操作失败', icon: 'none' })
    })
  },

  onDelete() {
    wx.showModal({
      title: '删除这条信息',
      content: '删除后不可恢复，确定吗？',
      confirmColor: '#FF6B81',
      success: async (res) => {
        if (!res.confirm) return
        await repo.deletePost('wall', this.data.id)
        wx.showToast({ title: '已删除', icon: 'success' })
        auth.safeBack(400)
      }
    })
  },

  onReport() {
    const id = this.postId || this.data.id
    if (!id) {
      wx.showToast({ title: '这篇帖子还不能举报', icon: 'none' })
      return
    }
    const sheet = this.selectComponent('#report-sheet')
    if (!sheet) {
      wx.showToast({ title: '举报菜单没打开', icon: 'none' })
      return
    }
    sheet.open({
      targetType: 'wall',
      targetId: id,
      onSubmit: (payload) => repo.submitReport(payload)
    })
  },

  async onDealStatusChange(e) {
    const dealStatus = e.currentTarget.dataset.id
    const post = this.data.post
    if (!post || !post.isOwner || dealStatus === post.dealStatus) return
    const result = await repo.updateWallDealStatus(this.data.id, dealStatus)
    if (!result.ok) {
      wx.showToast({ title: result.message || '更新失败', icon: 'none' })
      return
    }
    track.dealStatusChange({
      surface: 'wall_detail',
      contentType: 'wall',
      contentId: this.data.id,
      tag: post.tag || '',
      from: post.dealStatus || 'open',
      dealStatus
    })
    wx.showToast({ title: `已改为${store.wallDealStatusLabel(dealStatus)}`, icon: 'none' })
    this.refresh()
  },

  previewImage(e) {
    const scope = e.currentTarget.dataset.scope || 'post'
    const index = Number(e.currentTarget.dataset.index)
    let urls = []
    if (scope === 'draft') {
      urls = this.data.draftImages || []
    } else if (scope === 'comment') {
      const cid = e.currentTarget.dataset.cid
      const comment = (this.data.comments || []).find((item) => String(item.id) === String(cid))
      urls = (comment && comment.images) || []
    } else {
      urls = (this.data.post && this.data.post.images) || []
    }
    media.previewImages(urls[index] || urls[0], urls)
  },

  onShareAppMessage() {
    const post = this.data.post || {}
    const id = this.postId || this.data.id
    const card = share.wallPost(post, id)
    track.share({
      channel: 'app_message',
      surface: 'wall_detail',
      contentType: 'wall',
      contentId: id,
      tag: post.tag || ''
    })
    return card.appMessage
  },

  onShareTimeline() {
    const post = this.data.post || {}
    const id = this.postId || this.data.id
    const card = share.wallPost(post, id)
    track.share({
      channel: 'timeline',
      surface: 'wall_detail',
      contentType: 'wall',
      contentId: id,
      tag: post.tag || ''
    })
    return card.timeline
  }
})
