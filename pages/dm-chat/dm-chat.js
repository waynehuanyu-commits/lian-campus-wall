const repo = require('../../utils/repo')
const auth = require('../../utils/auth')
const inbox = require('../../utils/inbox')
const media = require('../../utils/media')
const { formatTime } = require('../../utils/util')

const DM_IMAGE_MAX = 3

Page({
  data: {
    conversationId: '',
    peerName: '',
    peerAvatar: '/images/default-avatars/avatar-01.jpg',
    myAvatar: '/images/default-avatars/avatar-01.jpg',
    messages: [],
    draft: '',
    draftImages: [],
    scrollInto: '',
    submitting: false
  },

  onLoad(query) {
    this.conversationId = decodeURIComponent(query.id || '')
    this.setData({ conversationId: this.conversationId })
  },

  onShow() {
    this._visible = true
    this.refresh()
  },

  onHide() {
    this._visible = false
  },

  onUnload() {
    this._visible = false
    this._loadToken = (this._loadToken || 0) + 1
  },

  async refresh() {
    if (!this.conversationId) return
    const token = (this._loadToken || 0) + 1
    this._loadToken = token
    const conversationId = this.conversationId
    try {
      const [convResult, messages, me] = await Promise.all([
        repo.getConversation(conversationId),
        repo.listMessages(conversationId),
        repo.getUser()
      ])
      if (token !== this._loadToken || !this._visible || this.conversationId !== conversationId) return
      if (!convResult || !convResult.ok) {
        wx.showToast({ title: (convResult && convResult.message) || '会话不存在', icon: 'none' })
        return
      }
      const conversation = convResult.conversation
      const unreadAtOpen = Number(conversation.unreadCount) || 0
      wx.setNavigationBarTitle({ title: conversation.peerName || '私信' })
      this.setData({
        peerName: conversation.peerName || '同学',
        peerAvatar: conversation.peerAvatar || '/images/default-avatars/avatar-01.jpg',
        myAvatar: (me && me.avatar) || '/images/default-avatars/avatar-01.jpg',
        messages: (messages || []).map((item) => this.decorateMessage(item))
      }, () => {
        this.scrollBottom()
        this.markShown(token, conversationId, unreadAtOpen)
      })
    } catch (err) {
      if (token !== this._loadToken) return
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' })
    }
  },

  async markShown(token, conversationId, unreadAtOpen) {
    if (!this._visible || token !== this._loadToken || this.conversationId !== conversationId) return
    try {
      const marked = await repo.markConversationRead(conversationId, unreadAtOpen)
      if (!marked || marked.ok === false) return
      await inbox.refresh(true)
    } catch (err) {
      // 消息已展示，已读写入失败时未读保留
    }
  },

  decorateMessage(item) {
    const images = Array.isArray(item && item.images) ? item.images.filter(Boolean).slice(0, DM_IMAGE_MAX) : []
    const status = (item && item.reviewStatus) || 'approved'
    return {
      ...item,
      content: String((item && item.content) || ''),
      images,
      mine: !!(item && item.mine),
      held: status !== 'approved',
      timeText: item && item.createdAt ? formatTime(item.createdAt) : ''
    }
  },

  scrollBottom() {
    const list = this.data.messages || []
    const last = list[list.length - 1]
    this.setData({
      scrollInto: last ? `m-${last.id}` : 'chat-bottom'
    })
  },

  onDraftInput(e) {
    this.setData({ draft: e.detail.value })
  },

  chooseImages() {
    if (!auth.ensureCanSpeak()) return
    const remain = DM_IMAGE_MAX - (this.data.draftImages || []).length
    if (remain <= 0) {
      wx.showToast({ title: `最多 ${DM_IMAGE_MAX} 张图`, icon: 'none' })
      return
    }
    media.chooseImages({
      count: remain,
      existing: this.data.draftImages || []
    }).then((images) => {
      this.setData({ draftImages: images.slice(0, DM_IMAGE_MAX) })
    }).catch(() => {
      wx.showToast({ title: '选图失败', icon: 'none' })
    })
  },

  removeDraftImage(e) {
    const draftImages = (this.data.draftImages || []).slice()
    draftImages.splice(e.currentTarget.dataset.index, 1)
    this.setData({ draftImages })
  },

  previewImage(e) {
    const id = e.currentTarget.dataset.id
    const index = Number(e.currentTarget.dataset.index) || 0
    const message = (this.data.messages || []).find((item) => item.id === id)
    const urls = (message && message.images) || []
    media.previewImages(urls[index] || urls[0], urls)
  },

  onCopy(e) {
    const content = (e.currentTarget.dataset.content || '').trim()
    if (!content) return
    wx.setClipboardData({
      data: content,
      success() {
        wx.showToast({ title: '已复制', icon: 'none' })
      }
    })
  },

  async onSend() {
    if (this.data.submitting || !auth.ensureCanSpeak()) return
    const content = (this.data.draft || '').trim()
    const images = (this.data.draftImages || []).slice()
    if (!content && !images.length) {
      wx.showToast({ title: '写点文字或发张图吧', icon: 'none' })
      return
    }
    this.setData({ submitting: true, draft: '', draftImages: [] })
    let result
    try {
      result = await repo.sendMessage(this.conversationId, content, images)
    } catch (err) {
      result = { ok: false, message: (err && err.message) || '发送失败' }
    }
    this.setData({ submitting: false })
    if (auth.showActionError(result)) {
      this.setData({ draft: content, draftImages: images })
      return
    }
    if (result && result.held) {
      wx.showToast({ title: result.notice || '审核通过后对方才能看到', icon: 'none' })
    }
    const sent = (result && result.message && typeof result.message === 'object')
      ? result.message
      : { id: `local_${Date.now()}`, content, images, senderId: 'me', mine: true, createdAt: Date.now() }
    this.setData({
      messages: (this.data.messages || []).concat(this.decorateMessage({ ...sent, mine: true, images: sent.images || images }))
    })
    this.scrollBottom()
  }
})
