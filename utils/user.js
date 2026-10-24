/**
 * 打开用户主页：匿名不可进；自己则切到「我的」
 */
function isTruthy(value) {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function openProfile(options = {}) {
  const userId = options.userId || options.id || ''
  if (isTruthy(options.anonymous)) {
    wx.showModal({
      title: '匿名发布',
      content: '对方选择了匿名，无法查看个人主页。',
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
  wx.navigateTo({ url: `/pages/user-profile/user-profile?id=${encodeURIComponent(userId)}` })
  return true
}

module.exports = {
  openProfile
}
