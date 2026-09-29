const repo = require('../../utils/repo')
const auth = require('../../utils/auth')
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
    draftPlaceholder: '说点什么…',
    submitting: false,
    canSpeak: false,
    speakCode: '',
    speakMessage: '',
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
      repo.bumpView('forum', this.postId).catch(() => {})
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
      const bundle = await repo.getPostBundle('forum', id)
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
          surface: 'forum_detail',
          contentType: 'forum',
          contentId: id,
          category: post.category || ''
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
      this.setData({
        loading: false,
        loadError: message
      })
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
      surface: 'forum_detail',
      contentType: 'forum',
      contentId: this.data.id,
      category: post.category || ''
    })
    try {
      const liked = await repo.toggleLike('forum', this.data.id)
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
    this.setData({ replyTo: null, draftPlaceholder: '说点什么…' })
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
    const result = await repo.addComment('forum', this.data.id, content, {
      parentId: replyTo ? replyTo.id : '',
      replyToId: replyTo ? replyTo.id : '',
      replyToName: replyTo ? replyTo.name : '',
      images
    })
    this.setData({ submitting: false })
    if (auth.showActionError(result)) return
    track.commentSuccess({
      surface: 'forum_detail',
      contentType: 'forum',
      contentId: this.data.id,
      category: (this.data.post && this.data.post.category) || '',
      isReply: !!replyTo,
      imageCount: images.length
    })
    this.setData({
      draft: '',
      draftImages: [],
      replyTo: null,
      draftPlaceholder: '说点什么…'
    })
    this.refresh({ soft: true })
  },

  onPin() {
    const post = this.data.post
    if (!post || !post.canManage || this._pinning) return
    this._pinning = true
    repo.pinPost('forum', post.id, !post.pinned).then((result) => {
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
      title: '删除帖子',
      content: '删除后不可恢复，确定吗？',
      confirmColor: '#FF6B81',
      success: async (res) => {
        if (!res.confirm) return
        await repo.deletePost('forum', this.data.id)
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
      targetType: 'forum',
      targetId: id,
      onSubmit: (payload) => repo.submitReport(payload)
    })
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
    const card = share.forumPost(post, id)
    track.share({
      channel: 'app_message',
      surface: 'forum_detail',
      contentType: 'forum',
      contentId: id,
      tag: post.category || ''
    })
    return card.appMessage
  },

  onShareTimeline() {
    const post = this.data.post || {}
    const id = this.postId || this.data.id
    const card = share.forumPost(post, id)
    track.share({
      channel: 'timeline',
      surface: 'forum_detail',
      contentType: 'forum',
      contentId: id,
      tag: post.category || ''
    })
    return card.timeline
  }
})
