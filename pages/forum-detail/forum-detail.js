const repo = require('../../utils/repo')
const auth = require('../../utils/auth')
const track = require('../../utils/track')
const share = require('../../utils/share')
const userNav = require('../../utils/user')
const media = require('../../utils/media')
const contact = require('../../utils/contact')
const {
  COMMENT_IMAGE_MAX,
  ROOT_PREVIEW_COUNT,
  buildCommentGroups,
  decorateCommentGroups,
  sliceRootCommentGroups,
  countAllComments,
  expandGroupForTarget,
  patchCommentLike
} = require('../../utils/comments')
const { formatTime } = require('../../utils/util')
const sharePoster = require('../../utils/share-poster')
const postNav = require('../../utils/post-nav')

function findCommentRow(groups, id) {
  const key = String(id)
  for (const group of groups) {
    if (group.root && String(group.root.id) === key) return group.root
    const hit = (group.replies || []).find((row) => String(row.id) === key)
    if (hit) return hit
  }
  return null
}

Page({
  data: {
    id: '',
    post: null,
    commentGroups: [],
    commentTotal: 0,
    commentSort: 'earliest',
    sortOptions: [
      { id: 'likes', name: '赞数' },
      { id: 'comments', name: '评论' },
      { id: 'earliest', name: '最早' },
      { id: 'latest', name: '最新' }
    ],
    commentsReady: false,
    commentsLoading: false,
    commentsError: '',
    commentsListExpanded: false,
    canExpandMoreComments: false,
    canCollapseMoreComments: false,
    hiddenRootCount: 0,
    draft: '',
    draftImages: [],
    replyTo: null,
    draftAnonymous: false,
    draftPlaceholder: '说点什么…',
    submitting: false,
    canSpeak: false,
    speakCode: '',
    speakMessage: '',
    keyboardHeight: 0,
    loading: true,
    loadError: '',
    shareSheetOpen: false,
    moreSheetOpen: false
  },

  async onLoad(query) {
    const id = postNav.normalizePostId(sharePoster.postIdFromQuery(query))
    this.postId = id
    this.targetCommentId = String((query && query.commentId) || '')
    this.fromShare = (query && query.from) || ''
    this._rawComments = []
    this._groups = []
    this.setData({ id: this.postId, loading: true, loadError: '' })
    share.enableMenus()
    if (!this.postId) {
      this.setData({
        loading: false,
        loadError: '帖子链接无效，缺少帖子 id',
        commentsLoading: false,
        commentsReady: true
      })
      return
    }
    await this.refresh({ trackView: true, initial: true })
    repo.bumpView('forum', this.postId).catch(() => {})
  },

  async onShow() {
    share.enableMenus()
    if (this._ready && Date.now() - (this._shownAt || 0) > 60000) this.refresh({ soft: true })
    this._shownAt = Date.now()
    this._ready = true
  },

  paintComments(groups) {
    const decorated = decorateCommentGroups(groups, this.data.commentSort)
    const sliced = sliceRootCommentGroups(decorated, {
      rootLimit: ROOT_PREVIEW_COUNT,
      listExpanded: !!this.data.commentsListExpanded
    })
    this._groups = groups
    this.setData({
      commentGroups: sliced.groups,
      commentTotal: countAllComments(groups),
      hiddenRootCount: sliced.hiddenRootCount,
      canExpandMoreComments: sliced.canExpandMore,
      canCollapseMoreComments: sliced.canCollapseMore,
      commentsReady: true,
      commentsLoading: false,
      commentsError: ''
    })
  },

  onExpandMoreComments() {
    this.setData({ commentsListExpanded: true })
    this.paintComments(this._groups || [])
  },

  onCollapseMoreComments() {
    this.setData({ commentsListExpanded: false })
    this.paintComments(this._groups || [])
  },

  scrollToComment(commentId) {
    const id = String(commentId || '')
    if (!id) return
    wx.createSelectorQuery()
      .select(`#c-${id}`)
      .boundingClientRect()
      .selectViewport()
      .scrollOffset()
      .exec((res) => {
        const rect = res && res[0]
        const view = res && res[1]
        if (!rect || !view) return
        wx.pageScrollTo({
          scrollTop: Math.max(0, view.scrollTop + rect.top - 120),
          duration: 280
        })
      })
  },

  async refresh(options = {}) {
    const id = this.postId || this.data.id
    const initial = !!options.initial || !this.data.post
    if (initial) this.setData({ loading: true, loadError: '' })
    if (!options.soft || !this.data.commentsReady) {
      this.setData({ commentsLoading: true, commentsError: '' })
    }
    try {
      const bundle = await repo.getPostBundle('forum', id)
      const post = bundle && bundle.post
      const comments = (bundle && bundle.comments) || []
      this.applyGate()
      if (!post) {
        this.setData({
          post: null,
          commentGroups: [],
          commentTotal: 0,
          commentsReady: true,
          commentsLoading: false,
          commentsError: '',
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
      this._rawComments = comments
      let groups = buildCommentGroups(comments, formatTime)
      if (this.targetCommentId) {
        groups = expandGroupForTarget(groups, this.targetCommentId)
      }
      this.setData({
        post: {
          ...post,
          timeText: formatTime(post.createdAt),
          categoryLabel: post.category || post.tag || ''
        },
        loading: false,
        loadError: ''
      })
      this.paintComments(groups)
      if (this.targetCommentId) {
        const targetId = this.targetCommentId
        this.targetCommentId = ''
        setTimeout(() => this.scrollToComment(targetId), 80)
      }
    } catch (err) {
      const message = (err && err.message) || '加载失败，请重试'
      if (!this.data.post) {
        this.setData({
          loading: false,
          loadError: message,
          commentsLoading: false
        })
      } else if (!this.data.commentsReady) {
        this.setData({
          loading: false,
          commentsLoading: false,
          commentsError: message,
          commentsReady: false
        })
      } else {
        this.setData({ loading: false, commentsLoading: false })
      }
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  retryPost() {
    this.refresh({ initial: true })
  },

  async retryComments() {
    const id = this.postId || this.data.id
    if (!id) return
    this.setData({ commentsLoading: true, commentsError: '' })
    try {
      const comments = await repo.listComments('forum', id)
      this._rawComments = comments || []
      let groups = buildCommentGroups(this._rawComments, formatTime)
      this.paintComments(groups)
    } catch (err) {
      this.setData({
        commentsLoading: false,
        commentsError: (err && err.message) || '评论加载失败',
        commentsReady: false
      })
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

  onSortTap(e) {
    const id = e.currentTarget.dataset.id
    if (!id || id === this.data.commentSort) return
    this.setData({ commentSort: id })
    this.paintComments(this._groups || [])
  },

  onExpandGroup(e) {
    const id = e.currentTarget.dataset.id
    const groups = (this._groups || []).map((group) => (
      String(group.id) === String(id) ? { ...group, expanded: true } : group
    ))
    this.paintComments(groups)
  },

  onCollapseGroup(e) {
    const id = e.currentTarget.dataset.id
    const groups = (this._groups || []).map((group) => (
      String(group.id) === String(id) ? { ...group, expanded: false } : group
    ))
    this.paintComments(groups)
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
    const { userid, anonymous } = e.currentTarget.dataset
    userNav.openProfile({ userId: userid, anonymous })
  },

  async onCommentLike(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    this._likingComments = this._likingComments || {}
    if (this._likingComments[id]) return
    const row = findCommentRow(this._groups || [], id)
    if (!row) return
    const nextLiked = !row.liked
    const nextCount = Math.max(0, (Number(row.likeCount) || 0) + (nextLiked ? 1 : -1))
    this._likingComments[id] = true
    this.paintComments(patchCommentLike(this._groups || [], id, nextLiked, nextCount))
    const result = await repo.toggleCommentLike(id)
    this._likingComments[id] = false
    if (!result || result.ok === false) {
      this.paintComments(patchCommentLike(this._groups || [], id, row.liked, row.likeCount))
      auth.showActionError(result || { ok: false, message: '操作失败' })
      return
    }
    this.paintComments(patchCommentLike(this._groups || [], id, result.liked, result.likeCount))
  },

  toggleDraftAnonymous() {
    this.setData({ draftAnonymous: !this.data.draftAnonymous })
  },

  onKeyboard(e) {
    const height = Number(e.detail && e.detail.height) || 0
    if (height === this.data.keyboardHeight) return
    this.setData({ keyboardHeight: height })
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

  goBindPhone() {
    auth.promptPhone()
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
      anonymous: !!this.data.draftAnonymous,
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

  onMoreTap() {
    this.setData({ moreSheetOpen: true })
  },

  closeMoreSheet() {
    this.setData({ moreSheetOpen: false })
  },

  onPin() {
    const post = this.data.post
    this.setData({ moreSheetOpen: false })
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

  onDeleteFromMore() {
    this.setData({ moreSheetOpen: false })
    this.onDelete()
  },

  onReportFromMore() {
    this.setData({ moreSheetOpen: false })
    this.onReport()
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
    if (!auth.ensureCanReport()) return
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

  onReportComment(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    if (!auth.ensureCanReport()) return
    const sheet = this.selectComponent('#report-sheet')
    if (!sheet) {
      wx.showToast({ title: '举报菜单没打开', icon: 'none' })
      return
    }
    sheet.open({
      targetType: 'comment',
      targetId: id,
      onSubmit: async (payload) => {
        const result = await repo.submitReport(payload)
        // 满 6 人举报后评论已转人工审核，刷新让它立即从列表消失
        if (result && result.ok && result.escalated) this.refresh({ soft: true })
        return result
      }
    })
  },

  findCommentImages(cid) {
    const groups = this.data.commentGroups || []
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i]
      if (String(group.root.id) === String(cid)) return group.root.images || []
      const hit = (group.shownReplies || []).find((item) => String(item.id) === String(cid))
        || (group.replies || []).find((item) => String(item.id) === String(cid))
      if (hit) return hit.images || []
    }
    return []
  },

  previewImage(e) {
    const scope = e.currentTarget.dataset.scope || 'post'
    const index = Number(e.currentTarget.dataset.index)
    let urls = []
    if (scope === 'draft') {
      urls = this.data.draftImages || []
    } else if (scope === 'comment') {
      urls = this.findCommentImages(e.currentTarget.dataset.cid)
    } else {
      urls = (this.data.post && this.data.post.images) || []
    }
    media.previewImages(urls[index] || urls[0], urls)
  },

  onGalleryPreview() {},

  noop() {},

  goHome() {
    wx.switchTab({ url: '/pages/forum/forum' })
  },

  onContactTap() {
    const post = this.data.post
    if (!post || !post.hasContact) {
      wx.showToast({ title: '发布者未留下联系方式', icon: 'none' })
      return
    }
    track.contactReveal({
      surface: 'forum_detail',
      contentType: 'forum',
      contentId: post.id,
      tag: post.tag || post.category || '',
      source: 'detail_action'
    })
    contact.openWallContact(post.id, { type: 'forum' })
  },

  onShareTap() {
    if (!this.data.post) return
    this.setData({ shareSheetOpen: true })
  },

  closeShareSheet() {
    this.setData({ shareSheetOpen: false })
  },

  onGeneratePoster() {
    const post = this.data.post
    const id = String(
      this.postId
      || this.data.id
      || (post && (post.id || post._id))
      || ''
    ).trim()
    this.setData({ shareSheetOpen: false })
    const publicOk = !!(post && (!post.reviewStatus || post.reviewStatus === 'approved'))
    if (!publicOk || !id || id === 'undefined') {
      wx.showToast({ title: '内容暂不可生成分享图', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/pages/share-poster/share-poster?source=forum&id=${encodeURIComponent(id)}`
    })
  },

  onShareAppMessage() {
    this.setData({ shareSheetOpen: false })
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
