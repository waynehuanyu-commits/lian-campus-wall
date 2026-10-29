/**
 * 打开用户资料：分身不可看；自己则切到「我的」
 */
function isTruthy(value) {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function openProfile(options = {}) {
  const userId = options.userId || options.id || ''
  if (isTruthy(options.anonymous)) {
    wx.showModal({
      title: '分身发布',
      content: '对方使用了分身，无法查看个人信息。',
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#2F7DFF'
    })
    return false
  }
  if (!userId) {
    wx.showToast({ title: '用户不存在', icon: 'none' })
    return false
  }
  const app = typeof getApp === 'function' ? getApp() : null
  const me = (app && app.globalData && app.globalData.user) || null
  if (me && me.id === userId) {
    wx.switchTab({ url: '/pages/mine/mine' })
    return true
  }
  // 优先在当前页弹出资料卡（不展示对方发过的内容）；页面没挂卡片时退回资料页
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  const page = pages[pages.length - 1]
  const card = page && typeof page.selectComponent === 'function' ? page.selectComponent('#user-card') : null
  if (card) {
    card.open(userId)
    return true
  }
  wx.navigateTo({ url: `/pages/user-profile/user-profile?id=${encodeURIComponent(userId)}` })
  return true
}

module.exports = {
  openProfile
}
