const store = require('../../utils/store')
const adminAuth = require('../../utils/admin-auth')
const share = require('../../utils/share')
const { formatTime } = require('../../utils/util')

const STATUS_TEXT = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拦截',
  simulated: '本地模拟',
  queued: '待服务端发送',
  ready: '待分享到微信群',
  confirm: '待群主确认发送'
}

Page({
  data: {
    nav: 'overview',
    navs: [
      { id: 'overview', name: '概览' },
      { id: 'keywords', name: '风控' },
      { id: 'digest', name: '推送' },
      { id: 'weekly', name: '热榜' },
      { id: 'groups', name: '客户群' },
      { id: 'school', name: '审核' },
      { id: 'more', name: '更多' }
    ],
    filters: [
      { id: 'pending', name: '待审核' },
      { id: '全部', name: '全部' },
      { id: 'approved', name: '已通过' },
      { id: 'rejected', name: '已驳回' }
    ],
    status: 'pending',
    overview: {},
    schoolList: [],
    interceptList: [],
    keywords: [],
    keywordDraft: '',
    accounts: [],
    securityLogs: [],
    groups: [],
    digestGroups: [],
    digestGroupText: '尚未指定',
    groupName: '',
    groupChatId: '',
    groupSender: '',
    groupReceiveDigest: true,
    editingId: '',
    editChatId: '',
    editSender: '',
    logs: [],
    progress: { size: 10, count: 0, remain: 10, queued: [] },
    digests: [],
    weeklyBoard: { title: '每周精选', subtitle: '', enabled: true, items: [], count: 0 },
    weeklyCandidates: [],
    weeklyKeyword: '',
    weeklyMax: store.WEEKLY_HOT_MAX || 20
  },

  onShow() {
    if (!adminAuth.ensureAdmin()) return
    share.enableMenus()
    this.reload()
  },

  onPullDownRefresh() {
    if (!adminAuth.isLoggedIn()) {
      wx.stopPullDownRefresh()
      return
    }
    this.reload()
    wx.stopPullDownRefresh()
  },

  reload() {
    this.loadSchool()
    const groups = store.getDistributeTargets().map((item) => ({
      ...item,
      designated: !!item.receiveDigest,
      typeText: '客户群 · 群主企微 / 同学微信',
      bindText: item.chatId ? `chatId：${item.chatId}` : '未填 chatId，仅本地模拟'
    }))
    const digestGroups = groups.filter((item) => item.designated && item.enabled)
    const progress = store.digestProgress()
    this.setData({
      overview: store.adminOverview(),
      keywords: store.getFilterKeywords().map((word) => ({
        word,
        locked: store.isLockedKeyword(word)
      })),
      accounts: store.listAccounts().map((item) => ({
        ...item,
        statusText: item.status === 'banned' ? '已封禁' : (item.status === 'muted' && item.muteUntil > Date.now() ? '禁言中' : '正常'),
        statusClass: item.status === 'banned' ? 'danger' : (item.status === 'muted' && item.muteUntil > Date.now() ? 'pending' : 'approved'),
        schoolText: [item.schoolName, item.schoolCampus].filter(Boolean).join(' · ') || '未认证',
        riskText: `风险 ${item.riskScore || 0} · 违规 ${item.violateCount || 0}`
      })),
      securityLogs: store.listSecurityLogs().slice(0, 40).map((item) => ({
        ...item,
        timeText: formatTime(item.createdAt),
        levelText: item.level === 'critical' ? '高危' : item.level === 'warn' ? '预警' : '记录',
        hitText: (item.hits || []).join('、')
      })),
      interceptList: store.listContentReviews('rejected').map((item) => ({
        ...item,
        timeText: formatTime(item.createdAt),
        typeText: item.contentType === 'forum' ? '学习分享' : '互助广场',
        hitText: (item.matchedKeywords || []).join('、') || '—'
      })),
      progress: {
        ...progress,
        queued: progress.queued.map((item, index) => ({
          ...item,
          index: index + 1
        }))
      },
      digests: store.getDigests().map((item) => ({
        ...item,
        timeText: formatTime(item.createdAt),
        count: (item.items || []).length
      })),
      weeklyBoard: (() => {
        const board = store.getWeeklyHot({ includeDisabled: true })
        return {
          ...board,
          items: (board.items || []).map((item) => ({
            ...item,
            key: `${item.contentType || 'wall'}_${item.contentId}`
          }))
        }
      })(),
      weeklyCandidates: store.listWeeklyHotCandidates({ keyword: this.data.weeklyKeyword }).map((item) => ({
        ...item,
        candKey: `${item.contentType || 'wall'}_${item.id}`
      })),
      weeklyMax: store.WEEKLY_HOT_MAX || 20,
      groups,
      digestGroups,
      digestGroupText: digestGroups.length ? digestGroups.map((item) => item.name).join('、') : '尚未指定',
      logs: store.getDistributeLogs().map((item) => ({
        ...item,
        timeText: formatTime(item.createdAt),
        statusText: STATUS_TEXT[item.status] || item.status,
        typeText: '客户群半自动',
        itemPreview: (item.items || []).slice(0, 3).map((one, index) => `${index + 1}.${one.title}`).join(' ')
      }))
    })
  },

  loadSchool() {
    const schoolList = store.listSchoolRequests(this.data.status).map((item) => ({
      ...item,
      statusText: STATUS_TEXT[item.status] || item.status,
      timeText: formatTime(item.createdAt)
    }))
    this.setData({ schoolList })
  },

  onNavTap(e) {
    const nav = e.currentTarget.dataset.id
    this.setData({
      nav,
      status: nav === 'school' ? 'pending' : this.data.status
    }, () => this.reload())
  },

  onWeeklyKeywordInput(e) {
    this.setData({ weeklyKeyword: e.detail.value })
  },

  onWeeklySearch() {
    this.setData({
      weeklyCandidates: store.listWeeklyHotCandidates({ keyword: this.data.weeklyKeyword }).map((item) => ({
        ...item,
        candKey: `${item.contentType || 'wall'}_${item.id}`
      }))
    })
  },

  onWeeklyTitleInput(e) {
    this.setData({ 'weeklyBoard.title': e.detail.value })
  },

  onWeeklySubtitleInput(e) {
    this.setData({ 'weeklyBoard.subtitle': e.detail.value })
  },

  onWeeklyEnabledTap() {
    const enabled = !this.data.weeklyBoard.enabled
    const result = store.updateWeeklyHotMeta({ enabled })
    if (!result.ok) {
      wx.showToast({ title: result.message || '更新失败', icon: 'none' })
      return
    }
    this.reload()
  },

  onWeeklySaveMeta() {
    const result = store.updateWeeklyHotMeta({
      title: this.data.weeklyBoard.title,
      subtitle: this.data.weeklyBoard.subtitle,
      enabled: this.data.weeklyBoard.enabled
    })
    wx.showToast({ title: result.ok ? '已保存' : (result.message || '保存失败'), icon: result.ok ? 'success' : 'none' })
    if (result.ok) this.reload()
  },

  onWeeklyAdd(e) {
    const { id, type } = e.currentTarget.dataset
    const result = store.addWeeklyHotItem(id, type || 'wall')
    wx.showToast({ title: result.ok ? '已加入' : (result.message || '失败'), icon: result.ok ? 'success' : 'none' })
    if (result.ok) this.reload()
  },

  onWeeklyRemove(e) {
    const { id, type } = e.currentTarget.dataset
    const result = store.removeWeeklyHotItem(id, type || 'wall')
    if (!result.ok) {
      wx.showToast({ title: result.message || '移除失败', icon: 'none' })
      return
    }
    this.reload()
  },

  onWeeklyMove(e) {
    const { id, direction, type } = e.currentTarget.dataset
    const result = store.moveWeeklyHotItem(id, direction, type || 'wall')
    if (!result.ok) {
      wx.showToast({ title: result.message || '调整失败', icon: 'none' })
      return
    }
    this.reload()
  },

  onFilterTap(e) {
    this.setData({ status: e.currentTarget.dataset.name }, () => this.loadSchool())
  },

  onKeywordInput(e) {
    this.setData({ keywordDraft: e.detail.value })
  },

  onAddKeyword() {
    const result = store.addFilterKeyword(this.data.keywordDraft)
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: 'none' })
      return
    }
    this.setData({ keywordDraft: '' })
    this.reload()
  },

  onRemoveKeyword(e) {
    const result = store.removeFilterKeyword(e.currentTarget.dataset.word)
    if (result && result.ok === false) {
      wx.showToast({ title: result.message, icon: 'none' })
      return
    }
    this.reload()
  },

  onMuteAccount(e) {
    this.changeAccount(e.currentTarget.dataset.id, 'muted', '管理员禁言 24 小时', 24)
  },

  onBanAccount(e) {
    this.changeAccount(e.currentTarget.dataset.id, 'banned', '管理员封禁该账号')
  },

  onUnbanAccount(e) {
    this.changeAccount(e.currentTarget.dataset.id, 'active', '')
  },

  changeAccount(id, status, reason, muteHours) {
    const title = status === 'banned' ? '封禁该账号？' : status === 'muted' ? '禁言该账号 24 小时？' : '解除该账号限制？'
    wx.showModal({
      title,
      content: status === 'active' ? '解除后可正常发言。' : '封禁/禁言后无法发帖、评论和查看联系方式。',
      confirmColor: '#3B82F6',
      success: (res) => {
        if (!res.confirm) return
        const result = store.setAccountStatus(id, { status, reason, muteHours })
        if (!result.ok) {
          wx.showToast({ title: result.message, icon: 'none' })
          return
        }
        wx.showToast({ title: '已更新', icon: 'success' })
        this.reload()
      }
    })
  },

  onApproveSchool(e) {
    this.reviewSchool(e.currentTarget.dataset.id, true)
  },

  onRejectSchool(e) {
    this.reviewSchool(e.currentTarget.dataset.id, false)
  },

  reviewSchool(id, approved) {
    wx.showModal({
      title: approved ? '通过该申请？' : '驳回该申请？',
      content: approved ? '通过后将更新对应用户的学校信息。' : '驳回后用户仍使用原学校信息。',
      confirmColor: '#3B82F6',
      success: (res) => {
        if (!res.confirm) return
        const result = store.reviewSchoolChange(id, { approved })
        if (!result.ok) {
          wx.showToast({ title: result.message, icon: 'none' })
          return
        }
        wx.showToast({ title: approved ? '已通过' : '已驳回', icon: 'success' })
        this.reload()
      }
    })
  },

  onFlushNow() {
    wx.showModal({
      title: '生成汇总？',
      content: `打包当前 ${this.data.progress.count} 条。本地只做演示；正式环境由云函数/后台走企微自动群发。`,
      confirmColor: '#3B82F6',
      success: (res) => {
        if (!res.confirm) return
        const flushed = store.flushDigest(true)
        if (!flushed) {
          wx.showToast({ title: '队列是空的', icon: 'none' })
          return
        }
        this.reload()
        wx.showModal({
          title: '汇总已生成',
          content: '本地汇总已生成。正式环境请配好企微参数，满 10 条会自动建群发，群主确认即可。',
          showCancel: false,
          confirmColor: '#3B82F6'
        })
      }
    })
  },

  onShareAppMessage(e) {
    const id = (e && e.target && e.target.dataset && e.target.dataset.id)
      || (this.data.digests[0] && this.data.digests[0].id)
      || ''
    const digest = store.getDigest(id) || {}
    return share.digestCard(digest).appMessage
  },

  onShareTimeline() {
    const digest = (this.data.digests && this.data.digests[0])
      ? (store.getDigest(this.data.digests[0].id) || {})
      : {}
    return share.digestCard(digest).timeline
  },

  onToggleGroup(e) {
    store.toggleDistributeTarget(e.currentTarget.dataset.id)
    this.reload()
  },

  onToggleDigestGroup(e) {
    store.toggleReceiveDigest(e.currentTarget.dataset.id)
    this.reload()
  },

  onGroupNameInput(e) {
    this.setData({ groupName: e.detail.value })
  },

  onGroupChatIdInput(e) {
    this.setData({ groupChatId: e.detail.value })
  },

  onGroupSenderInput(e) {
    this.setData({ groupSender: e.detail.value })
  },

  onGroupDigestChange(e) {
    this.setData({ groupReceiveDigest: !!e.detail.value })
  },

  onEditGroup(e) {
    const id = e.currentTarget.dataset.id
    const group = (this.data.groups || []).find((item) => item.id === id)
    if (!group) return
    this.setData({
      editingId: this.data.editingId === id ? '' : id,
      editChatId: group.chatId || '',
      editSender: group.sender || ''
    })
  },

  onEditChatIdInput(e) {
    this.setData({ editChatId: e.detail.value })
  },

  onEditSenderInput(e) {
    this.setData({ editSender: e.detail.value })
  },

  onSaveGroupBind() {
    const result = store.updateDistributeTarget(this.data.editingId, {
      chatId: this.data.editChatId,
      sender: this.data.editSender
    })
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: 'none' })
      return
    }
    this.setData({ editingId: '', editChatId: '', editSender: '' })
    wx.showToast({ title: '已保存客户群配置', icon: 'none' })
    this.reload()
  },

  onAddGroup() {
    const result = store.addDistributeTarget({
      name: this.data.groupName,
      chatId: this.data.groupChatId,
      sender: this.data.groupSender,
      receiveDigest: this.data.groupReceiveDigest
    })
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: 'none' })
      return
    }
    this.setData({
      groupName: '',
      groupChatId: '',
      groupSender: '',
      groupReceiveDigest: true
    })
    wx.showToast({ title: result.group.receiveDigest ? '已指定该客户群' : '已添加群', icon: 'none' })
    this.reload()
  },

  goDigest(e) {
    wx.navigateTo({ url: `/pages/digest/digest?id=${e.currentTarget.dataset.id}` })
  },

  onReset() {
    wx.showModal({
      title: '恢复示例数据',
      content: '将清空本地发布、点赞和评论，并恢复演示内容。个人资料会保留。',
      confirmColor: '#3B82F6',
      success: (res) => {
        if (!res.confirm) return
        store.resetDemo()
        wx.showToast({ title: '已恢复', icon: 'success' })
        this.reload()
      }
    })
  },

  onLogout() {
    wx.showModal({
      title: '退出管理端？',
      content: '退出后需重新登录才能进入控制台。',
      confirmColor: '#3B82F6',
      success: (res) => {
        if (!res.confirm) return
        adminAuth.logout()
        wx.reLaunch({ url: '/packageAdmin/login/login' })
      }
    })
  }
})
