const auth = require('./auth')
const repo = require('./repo')

function ensureCanViewContact() {
  const gate = auth.cachedGate()
  if (gate.ok) return true
  if (gate.code === 'NEED_AUTH') {
    wx.showModal({
      title: '仅认证同学可查看',
      content: '联系方式不对游客公开。认证学校后，才能查看并复制微信号。',
      confirmText: '去认证',
      cancelText: '先看看',
      confirmColor: '#FF6B81',
      success(res) {
        if (res.confirm) auth.goSchoolAuth()
      }
    })
    return false
  }
  wx.showModal({
    title: gate.title || '暂无法查看',
    content: gate.message,
    showCancel: false,
    confirmColor: '#FF6B81'
  })
  return false
}

function copyText(value, toast) {
  return new Promise((resolve) => {
    wx.setClipboardData({
      data: String(value || ''),
      success() {
        wx.showToast({ title: toast || '已复制', icon: 'success' })
        resolve(true)
      },
      fail() {
        wx.showToast({ title: '复制失败', icon: 'none' })
        resolve(false)
      }
    })
  })
}

function showCopySheet(contact) {
  const value = contact.contactValue || ''

  wx.showActionSheet({
    itemList: ['复制微信号', '复制后去微信添加'],
    success() {
      copyText(value, '微信号已复制')
    }
  })
}

async function openWallContact(postId, options = {}) {
  if (!postId) return null
  if (!ensureCanViewContact()) return null

  wx.showLoading({ title: '获取中', mask: true })
  let result
  try {
    result = await repo.revealWallContact(postId)
  } finally {
    wx.hideLoading()
  }

  if (!result || !result.ok) {
    wx.showToast({ title: (result && result.message) || '暂无法查看', icon: 'none' })
    return null
  }

  if (typeof options.onReady === 'function') {
    options.onReady(result)
    return result
  }

  showCopySheet(result)
  return result
}

module.exports = {
  openWallContact,
  showCopySheet,
  copyText,
  ensureCanViewContact
}
