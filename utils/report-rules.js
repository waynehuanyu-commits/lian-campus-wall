// 举报风控规则：小程序本地演示、云函数、运营后台共用同一份逻辑。
// 云函数里有一份副本 cloudfunctions/userApi/lib/report-rules.js，改这里要同步改那里。

// 同一帖子/评论被这么多名不同的、有举报资格的用户举报后，自动隐藏进人工审核
const REPORT_THRESHOLD = 6

/**
 * 能否举报：必须登录、完成学校认证、账号未封禁、举报权限未被后台限制。
 * 后台账号（appAdmin）和官方身份不受学校认证限制。
 */
function reportEligibility(user) {
  if (!user || !user.id || user.id === 'guest_readonly') {
    return { ok: false, code: 'NEED_LOGIN', message: '登录后才能举报' }
  }
  if (user.status === 'banned') {
    return { ok: false, code: 'BANNED', message: '账号已封禁，无法举报' }
  }
  if (user.reportBlocked) {
    return { ok: false, code: 'REPORT_BLOCKED', message: user.reportBlockedReason || '你的举报权限已被限制' }
  }
  const official = !!(user.appAdmin || user.officialLogin || user.id === 'official_lian_wall')
  if (!official && !(user.schoolName && user.schoolLocked)) {
    return { ok: false, code: 'NEED_AUTH', message: '完成学校认证后才能举报' }
  }
  return { ok: true, code: 'OK', message: '' }
}

/**
 * 当前这一轮还有效的举报人：只算待处理、且在上次处理（判无效/恢复/下架）之后提交的举报。
 * 已判无效或已处理的旧举报不再参与计数，不会反复触发隐藏。同一账号只算一次。
 */
function activeReporterIds(reports, target) {
  const clearedAt = Number(target && target.reportClearedAt) || 0
  const ids = new Set()
  ;(reports || []).forEach((item) => {
    if (!item || item.status !== 'pending') return
    if ((Number(item.createdAt) || 0) < clearedAt) return
    if (item.reporterEligible === false) return
    if (item.reporterId) ids.add(item.reporterId)
  })
  return ids
}

/** 达到阈值且内容当前仍公开时才自动隐藏；已在审核或已下架的不重复处理 */
function shouldAutoHide(reporterCount, target, isPublic) {
  if (reporterCount < REPORT_THRESHOLD) return false
  if (!target) return false
  return isPublic(target.reviewStatus || 'approved')
}

module.exports = {
  REPORT_THRESHOLD,
  reportEligibility,
  activeReporterIds,
  shouldAutoHide
}
