const store = require('./store')
const repo = require('./repo')
const reportRules = require('./report-rules')

function cachedGate() {
  const app = getApp()
  if (app && app.globalData && app.globalData.speakGate) return app.globalData.speakGate
  return store.getSpeakGate()
}

function canSpeak() {
  return !!cachedGate().ok
}

function goSchoolAuth() {
  wx.navigateTo({
    url: '/pages/school-auth/school-auth',
    fail() {
      wx.switchTab({ url: '/pages/mine/mine' })
    }
  })
}

async function goLogin() {
  const existing = cachedGate()
  if (existing && existing.ok) {
    wx.showToast({ title: '已可发言', icon: 'success' })
    return
  }
  // 云端会按 OPENID 自动建号，本地也会默认建用户；真正卡点往往是学校认证
  if (existing && (existing.code === 'NEED_AUTH' || existing.code === 'NEED_PHONE')) {
    goSchoolAuth()
    return
  }

  wx.showLoading({ title: '准备中', mask: true })
  try {
    const result = await repo.login()
    wx.hideLoading()
    if (!result || !result.ok) {
      wx.showToast({ title: (result && result.message) || '登录失败', icon: 'none' })
      return
    }
    const gate = result.speakGate || store.getSpeakGate(result.user)
    if (gate && gate.ok) {
      wx.showToast({ title: '已可发言', icon: 'success' })
      return
    }
    if (gate && (gate.code === 'NEED_AUTH' || gate.code === 'NEED_PHONE')) {
      goSchoolAuth()
      return
    }
    if (gate && gate.code === 'NEED_LOGIN') {
      wx.showToast({ title: '登录未完成，请重试', icon: 'none' })
      return
    }
    wx.showModal({
      title: (gate && gate.title) || '暂无法操作',
      content: (gate && gate.message) || '当前账号暂不能发言',
      showCancel: false,
      confirmColor: '#2F7DFF'
    })
  } catch (err) {
    wx.hideLoading()
    wx.showToast({ title: (err && err.message) || '登录失败', icon: 'none' })
  }
}

function safeBack(delay = 0) {
  const go = () => {
    wx.navigateBack({
      fail() {
        wx.switchTab({ url: '/pages/forum/forum' })
      }
    })
  }
  if (delay > 0) setTimeout(go, delay)
  else go()
}

// 绑定手机号的入口放在学校认证页
function promptPhone(message) {
  wx.showModal({
    title: '需要绑定手机号',
    content: message || '发帖、评论和举报前请绑定手机号，用于身份核验和违规追溯，仅管理员可见，不会公开展示。',
    confirmText: '去绑定',
    cancelText: '先看看',
    confirmColor: '#2F7DFF',
    success(res) {
      if (res.confirm) goSchoolAuth()
    }
  })
}

function ensureCanSpeak() {
  const gate = cachedGate()
  if (gate.ok) return true
  if (gate.code === 'NEED_LOGIN') {
    wx.showModal({
      title: gate.title || '开通发言',
      content: gate.message || '发帖、评论前请先完成登录与学校认证',
      confirmText: '去开通',
      cancelText: '先看看',
      confirmColor: '#2F7DFF',
      success(res) {
        if (res.confirm) goLogin()
      }
    })
    return false
  }
  if (gate.code === 'NEED_AUTH') {
    wx.showModal({
      title: gate.title || '需要先认证学校',
      content: gate.message || '发帖、评论前请先完成学校认证',
      confirmText: '去认证',
      cancelText: '先看看',
      confirmColor: '#2F7DFF',
      success(res) {
        if (res.confirm) goSchoolAuth()
      }
    })
    return false
  }
  if (gate.code === 'NEED_PHONE') {
    promptPhone(gate.message)
    return false
  }
  wx.showModal({
    title: gate.title || '暂无法操作',
    content: gate.message || '当前账号暂不能发言',
    showCancel: false,
    confirmColor: '#2F7DFF'
  })
  return false
}

function promptReportBlocked(check) {
  if (check.code === 'NEED_LOGIN') {
    wx.showModal({
      title: '登录后才能举报',
      content: '浏览开放。举报需要先登录并完成学校认证。',
      confirmText: '去开通',
      cancelText: '先看看',
      confirmColor: '#2F7DFF',
      success(res) {
        if (res.confirm) goLogin()
      }
    })
    return
  }
  if (check.code === 'NEED_AUTH') {
    wx.showModal({
      title: '需要先认证学校',
      content: '完成学校认证后才能举报。填写所在学校即可，提交后立即生效。',
      confirmText: '去认证',
      cancelText: '先看看',
      confirmColor: '#2F7DFF',
      success(res) {
        if (res.confirm) goSchoolAuth()
      }
    })
    return
  }
  if (check.code === 'NEED_PHONE') {
    promptPhone('绑定手机号后才能举报。手机号仅管理员可见，不会公开展示。')
    return
  }
  wx.showToast({ title: check.message || '当前账号不能举报', icon: 'none' })
}

// 举报资格：登录 + 学校认证 + 未封禁 + 未被限制举报；服务端用同一套规则再校验一次
function ensureCanReport() {
  const app = getApp()
  const user = (app && app.globalData && app.globalData.user) || null
  const check = reportRules.reportEligibility(repo.isLoggedOut() ? null : user, { requirePhone: !!(user && user.phoneRequired) })
  if (check.ok) return true
  promptReportBlocked(check)
  return false
}

function showActionError(result) {
  if (!result || result.ok) return false
  if (result.code === 'NEED_LOGIN') {
    ensureCanSpeak()
    return true
  }
  if (result.code === 'NEED_AUTH') {
    ensureCanSpeak()
    return true
  }
  if (result.code === 'NEED_PHONE') {
    promptPhone(result.message)
    return true
  }
  const titles = {
    RATE_LIMIT: '操作过于频繁',
    DUPLICATE: '重复发布',
    EDIT_REQUIRED: '请修改后再发布',
    REJECTED: '未通过审核',
    EMERGENCY_BLOCK: '内容已拦截',
    BANNED: '账号已封禁',
    MUTED: '账号禁言中',
    NETWORK: '网络异常'
  }
  wx.showModal({
    title: titles[result.code] || '未通过校验',
    content: result.message || '请稍后再试',
    showCancel: false,
    confirmColor: '#2F7DFF'
  })
  return true
}

module.exports = {
  canSpeak,
  goSchoolAuth,
  goLogin,
  ensureCanSpeak,
  ensureCanReport,
  promptReportBlocked,
  promptPhone,
  showActionError,
  safeBack,
  cachedGate
}
