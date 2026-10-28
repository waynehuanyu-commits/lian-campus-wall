/**
 * 用户举报：帖子 / 用户主页共用
 */
const REPORT_REASONS = [
  { id: 'spam', label: '广告引流 / 刷单返利' },
  { id: 'fraud', label: '疑似诈骗 / 借贷博彩' },
  { id: 'abuse', label: '辱骂 / 人身攻击' },
  { id: 'porn', label: '色情低俗' },
  { id: 'privacy', label: '偷拍 / 隐私曝光' },
  { id: 'hate', label: '仇恨 / 暴力极端' },
  { id: 'other', label: '其他违规' }
]

const { REPORT_THRESHOLD } = require('./report-rules')

function reasonLabel(id) {
  const row = REPORT_REASONS.find((item) => item.id === id)
  return (row && row.label) || '其他违规'
}

/**
 * @param {{ targetType: 'forum'|'wall'|'user', targetId: string, onSubmit: Function }} opts
 */
function submitReason(reason, onSubmit, targetType, targetId) {
  wx.showLoading({ title: '提交中', mask: true })
  return Promise.resolve(onSubmit({
    targetType,
    targetId,
    reason: reason.id,
    reasonLabel: reason.label
  })).then((result) => {
    wx.hideLoading()
    if (!result || !result.ok) {
      if (result && ['NEED_LOGIN', 'NEED_AUTH', 'NEED_PHONE'].indexOf(result.code) >= 0) {
        require('./auth').promptReportBlocked(result)
        return
      }
      wx.showToast({ title: (result && result.message) || '举报失败', icon: 'none' })
      return
    }
    wx.showToast({
      title: result.escalated ? '已提交，内容进入审核' : '感谢反馈，我们会尽快处理',
      icon: 'none'
    })
  }).catch(() => {
    wx.hideLoading()
    wx.showToast({ title: '举报失败', icon: 'none' })
  })
}

function submitChosen(reason, opts = {}) {
  const { targetType, targetId, onSubmit } = opts
  if (!reason || typeof onSubmit !== 'function') return
  submitReason(reason, onSubmit, targetType, targetId)
}

function openReportSheet(opts = {}) {
  const { targetType, targetId, onSubmit } = opts
  if (!targetType || !targetId || typeof onSubmit !== 'function') return
  // 微信 actionSheet 最多 6 项，7 个原因会直接失败，按钮看起来没反应
  const head = REPORT_REASONS.slice(0, 5)
  const rest = REPORT_REASONS.slice(5)
  wx.showActionSheet({
    itemList: head.map((item) => item.label).concat(['更多原因']),
    success: (res) => {
      const picked = head[res.tapIndex]
      if (picked) {
        submitReason(picked, onSubmit, targetType, targetId)
        return
      }
      wx.showActionSheet({
        itemList: rest.map((item) => item.label),
        success: (more) => {
          const reason = rest[more.tapIndex]
          if (reason) submitReason(reason, onSubmit, targetType, targetId)
        }
      })
    }
  })
}

module.exports = {
  REPORT_REASONS,
  REPORT_THRESHOLD,
  reasonLabel,
  openReportSheet,
  submitChosen
}
