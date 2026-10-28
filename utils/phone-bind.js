const repo = require('./repo')

/**
 * 处理 <button open-type="getPhoneNumber"> 的回调：拿到一次性 code 交给云函数换号码并绑定。
 * 用户拒绝授权或额度不足时 detail 里没有 code。成功后更新全局用户并返回 true。
 */
async function bindFromEvent(e) {
  const detail = (e && e.detail) || {}
  if (!detail.code) {
    const denied = /deny|cancel/i.test(detail.errMsg || '')
    wx.showToast({ title: denied ? '需要授权手机号才能完成绑定' : '暂时无法获取手机号，请稍后再试', icon: 'none' })
    return false
  }
  let result
  try {
    result = await repo.bindPhone(detail.code)
  } catch (err) {
    result = { ok: false, message: (err && err.message) || '绑定失败，请重试' }
  }
  if (!result || !result.ok) {
    wx.showModal({
      title: '手机号没绑上',
      content: (result && result.message) || '绑定失败，请重试',
      showCancel: false,
      confirmColor: '#2F7DFF'
    })
    return false
  }
  if (result.user) getApp().globalData.user = result.user
  wx.showToast({ title: '手机号已绑定', icon: 'success' })
  return true
}

module.exports = {
  bindFromEvent
}
