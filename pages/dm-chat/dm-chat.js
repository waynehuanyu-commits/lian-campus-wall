const repo = require('../../utils/repo')
const auth = require('../../utils/auth')
const inbox = require('../../utils/inbox')
const { formatTime } = require('../../utils/util')

Page({
  data: {
    conversationId: '',
    peerName: '',
    peerAvatar: '/images/avatar-default.png',
    myAvatar: '/images/avatar-default.png',
    messages: [],
    draft: '',
    scrollInto: '',
    submitting: false
  },

  onLoad(query) {
    this.conversationId = decodeURIComponent(query.id || '')
    this.setData({ conversationId: this.conversationId })
  },

  onShow() {
    this.refresh()
  },

  async refresh() {
    if (!this.conversationId) return
    const [convResult, messages, me] = await Promise.all([
      repo.getConversation(this.conversationId),
      repo.listMessages(this.conversationId),
      repo.getUser()
    ])
    if (!convResult || !convResult.ok) {
      wx.showToast({ title: (convResult && convResult.message) || '会话不存在', icon: 'none' })
      return
    }
    const conversation = convResult.conversation
    wx.setNavigationBarTitle({ title: conversation.peerName || '私信' })
    this.setData({
      peerName: conversation.peerName || '同学',
      peerAvatar: conversation.peerAvatar || '/images/avatar-default.png',
      myAvatar: (me && me.avatar) || '/images/avatar-default.png',
      messages: (messages || []).map((item) => this.decorateMessage(item))
    })
    this.scrollBottom()
    repo.markConversationRead(this.conversationId)
      .then(() => inbox.refresh(true))
      .catch(() => {})
  },

  decorateMessage(item) {
    return {
      ...item,
      content: String((item && item.content) || ''),
      mine: !!(item && item.mine),
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
    if (!content) {
      wx.showToast({ title: '先写点内容吧', icon: 'none' })
      return
    }
    this.setData({ submitting: true, draft: '' })
    const result = await repo.sendMessage(this.conversationId, content)
    this.setData({ submitting: false })
    if (auth.showActionError(result)) {
      this.setData({ draft: content })
      return
    }
    const sent = (result && result.message && typeof result.message === 'object')
      ? result.message
      : { id: `local_${Date.now()}`, content, senderId: 'me', mine: true, createdAt: Date.now() }
    this.setData({
      messages: (this.data.messages || []).concat(this.decorateMessage({ ...sent, mine: true }))
    })
    this.scrollBottom()
  }
})
