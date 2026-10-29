// 举报工单 / 内容管理 / 处置记录。依赖 app.js 里的全局：state、api、esc、formatTime、authorHtml、
// listOrEmpty、statusClass、render、TYPE_LABEL。数据按页向服务端取，筛选和搜索也在服务端做。

// forum / wall 只是两张帖子表的历史分法，界面统一叫「帖子」（见 app.js TYPE_LABEL 的说明）
const MOD_TYPE_LABEL = { forum: '帖子', wall: '帖子', comment: '评论', user: '用户', reporter: '举报者' }
const CONTENT_STATUS_TABS = [
  { id: 'public', label: '已公开' },
  { id: 'queue', label: '待审核' },
  { id: 'removed', label: '已下架' },
  { id: '全部', label: '全部' }
]
const ACCOUNT_STATUS_LABEL = { active: '正常', muted: '禁言中', banned: '已封号', unknown: '账号不存在' }
const LOG_ACTION_LABEL = {
  takedown: '下架', restore: '恢复公开', dismiss: '举报不成立', mute_author: '禁言作者', ban_author: '封号作者',
  block_report: '限制举报', unblock_report: '恢复举报权限', mute: '禁言', ban: '封号',
  approved: '审核通过', rejected: '审核驳回', manual_review: '转人工', edit_required: '要求修改'
}

state.reportQuery = state.reportQuery || { status: 'pending', q: '', page: 0 }
state.contentQuery = state.contentQuery || { type: 'forum', status: 'public', q: '', page: 0 }
state.logQuery = state.logQuery || { q: '', page: 0 }

function qs(params) {
  return Object.keys(params)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key] == null ? '' : params[key])}`)
    .join('&')
}

function pagerHtml(total, page, size, attr) {
  const pages = Math.max(1, Math.ceil((total || 0) / (size || 20)))
  return `
    <div class="mod-pager">
      <button type="button" class="quiet" ${attr}="${page - 1}" ${page <= 0 ? 'disabled' : ''}>上一页</button>
      <span class="meta">第 ${page + 1} / ${pages} 页 · 共 ${total || 0} 条</span>
      <button type="button" class="quiet" ${attr}="${page + 1}" ${page + 1 >= pages ? 'disabled' : ''}>下一页</button>
    </div>`
}

function searchBarHtml(id, value, placeholder) {
  return `
    <form class="row gap mod-search" data-search-form="${id}">
      <input id="${id}" placeholder="${esc(placeholder)}" value="${esc(value)}" />
      <button type="submit">搜索</button>
      ${value ? `<button type="button" class="quiet" data-search-clear="${id}">清空</button>` : ''}
    </form>`
}

function bindSearch(panel, id, onSearch) {
  const form = panel.querySelector(`[data-search-form="${id}"]`)
  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault()
      onSearch(panel.querySelector(`#${id}`).value.trim())
    }
  }
  const clear = panel.querySelector(`[data-search-clear="${id}"]`)
  if (clear) clear.onclick = () => onSearch('')
}

function imagesHtml(images) {
  const list = Array.isArray(images) ? images.filter(Boolean) : []
  if (!list.length) return ''
  return `<div class="image-row">${list.map((src) => `<a href="${esc(src)}" target="_blank" rel="noreferrer"><img class="thumb" src="${esc(src)}" alt=""></a>`).join('')}</div>`
}

function accountTag(account) {
  if (!account) return ''
  const status = account.status || 'active'
  const parts = []
  if (status !== 'active') parts.push(`<span class="status-pill ${status === 'banned' ? 'danger' : 'warn'}">${esc(ACCOUNT_STATUS_LABEL[status] || status)}</span>`)
  if (account.reportBlocked) parts.push('<span class="status-pill danger">已限制举报</span>')
  return parts.join(' ')
}

function askReason(title, required) {
  const value = window.prompt(title, '')
  if (value === null) return null
  const text = value.trim()
  if (required && !text) {
    alert('需要填写原因')
    return null
  }
  return text
}

// ---------- 侧边抽屉 ----------

function openDrawer(html) {
  closeDrawer()
  const box = document.createElement('div')
  box.className = 'drawer'
  box.id = 'mod-drawer'
  box.innerHTML = `<div class="drawer-mask" data-drawer-close></div><div class="drawer-panel mod-drawer-panel">${html}</div>`
  document.body.appendChild(box)
  box.querySelectorAll('[data-drawer-close]').forEach((el) => { el.onclick = closeDrawer })
  return box.querySelector('.drawer-panel')
}

function closeDrawer() {
  const old = document.getElementById('mod-drawer')
  if (old) old.remove()
}

// ---------- 举报工单 ----------

async function reloadReports() {
  const query = state.reportQuery
  const result = await api(`/api/reports?${qs({ status: query.status, q: query.q, page: query.page })}`)
  if (!result.ok) {
    state.data.reports = { error: result.message || '加载失败', cases: [] }
  } else {
    state.data.reports = result
  }
  if (state.nav === 'reports') render()
}

function reporterLine(report) {
  const who = report.reporter || {}
  const stats = who.stats || {}
  return `
    <div class="mod-reporter">
      <div class="row">
        <span><strong>${esc(report.reasonLabel)}</strong>${report.counted ? ' <span class="status-pill info">计入本轮</span>' : ''}</span>
        <span class="meta">${esc(report.resolveLabel)}${report.resolvedBy ? ` · ${esc(report.resolvedBy)}` : ''}</span>
      </div>
      <div class="meta">
        举报者 <button type="button" class="link-btn" data-reporter="${esc(report.reporterId)}">${esc(who.nickname || report.reporterName || '未设昵称')}（${esc(report.reporterId)}）</button>
        · ${esc(who.schoolName || '未认证')} · ${formatTime(report.createdAt)} ${accountTag(who)}
      </div>
      <div class="meta">历史举报 ${stats.total || 0} 次：成立 ${stats.upheld || 0} · 不成立 ${stats.dismissed || 0} · 待处理 ${stats.pending || 0}</div>
      ${report.note ? `<div class="meta">补充：${esc(report.note)}</div>` : ''}
      ${report.resolveNote ? `<div class="meta">处理说明：${esc(report.resolveNote)}${report.resolvedAt ? ` · ${formatTime(report.resolvedAt)}` : ''}</div>` : ''}
    </div>`
}

function reportCaseHtml(item) {
  const author = item.author
  const isUser = item.targetType === 'user'
  return `
    <div class="card list-item mod-case">
      <div class="row">
        <strong>${esc(item.title || '未命名')}</strong>
        <span>${esc(MOD_TYPE_LABEL[item.targetType] || item.targetType)} · 本轮有效举报 ${item.activeReporterCount} / ${item.threshold} 人</span>
      </div>
      <div class="meta">
        内容作者 ${author ? `${esc(author.nickname || item.authorName || '未设昵称')}（${esc(author.id)}）` : '—'}${item.anonymous ? ` <span class="anon-tag">分身发布 · 对外显示「${esc(item.authorName || '')}」</span>` : ''}
        ${author ? accountTag(author) : ''}
        ${item.reviewStatusLabel ? ` · <span class="status-pill ${statusClass(item.reviewStatus)}">${esc(item.reviewStatusLabel)}</span>` : ''}
        ${item.reportHidden ? ' <span class="status-pill warn">因举报自动隐藏</span>' : ''}
      </div>
      ${item.parent ? `<div class="meta">所属帖子：${esc(item.parent.title)}</div>` : ''}
      ${item.content ? `<p class="mod-text">${esc(item.content)}</p>` : ''}
      ${imagesHtml(item.images)}
      ${!isUser && item.exists ? `<div><button type="button" class="link-btn" data-content-detail="${esc(item.targetType)}:${esc(item.targetId)}">查看完整内容和上下文</button></div>` : ''}
      ${item.status === 'pending' ? `
        <div class="actions mod-case-actions">
          <span class="meta">处置内容作者：</span>
          <button type="button" data-case-act="dismiss" data-type="${esc(item.targetType)}" data-id="${esc(item.targetId)}">举报不成立${item.reportHidden ? '，恢复公开' : ''}</button>
          ${!isUser ? `<button type="button" data-case-act="takedown" data-type="${esc(item.targetType)}" data-id="${esc(item.targetId)}">下架内容</button>` : ''}
          <button type="button" data-case-act="mute_author" data-type="${esc(item.targetType)}" data-id="${esc(item.targetId)}">禁言作者 24 小时</button>
          <button type="button" class="danger-btn" data-case-act="ban_author" data-type="${esc(item.targetType)}" data-id="${esc(item.targetId)}">封号作者</button>
        </div>` : ''}
      <details class="mod-reports" ${item.status === 'pending' ? 'open' : ''}>
        <summary>举报记录 ${item.reports.length} 条（${item.pendingCount} 条待处理）</summary>
        ${item.reports.map(reporterLine).join('')}
      </details>
    </div>`
}

function renderReports(panel, data) {
  const query = state.reportQuery
  const result = data || { cases: [] }
  const counts = result.counts || {}
  const tabs = [
    { id: 'pending', label: `待处理 ${counts.pending || 0}` },
    { id: 'resolved', label: `已处理 ${counts.resolved || 0}` },
    { id: '全部', label: `全部 ${counts.all || 0}` }
  ]
  panel.innerHTML = `
    <div class="card">
      <h3>举报工单</h3>
      <p class="muted">按被举报对象合并。只有完成学校认证的用户能举报，同一账号对同一内容只算一次；本轮凑满 ${(result.cases[0] && result.cases[0].threshold) || 6} 名不同用户后自动隐藏进人工审核。判「举报不成立」会恢复公开，之后旧举报不再计数。举报者信息只在后台可见，举报不成立不会自动处罚举报者。</p>
      <div class="chips">${tabs.map((tab) => `<button type="button" class="chip ${query.status === tab.id ? 'active' : ''}" data-report-status="${tab.id}">${tab.label}</button>`).join('')}</div>
      ${searchBarHtml('report-q', query.q, '搜索举报者昵称 / 账号编号、内容作者编号、内容标题、举报原因')}
    </div>
    ${result.error ? `<div class="card danger">${esc(result.error)}</div>` : ''}
    ${listOrEmpty(result.cases, reportCaseHtml)}
    ${pagerHtml(result.total, result.page || 0, result.size, 'data-report-page')}
  `
  panel.querySelectorAll('[data-report-status]').forEach((btn) => {
    btn.onclick = () => {
      state.reportQuery = { ...query, status: btn.dataset.reportStatus, page: 0 }
      reloadReports()
    }
  })
  panel.querySelectorAll('[data-report-page]').forEach((btn) => {
    btn.onclick = () => {
      state.reportQuery = { ...query, page: Number(btn.dataset.reportPage) || 0 }
      reloadReports()
    }
  })
  bindSearch(panel, 'report-q', (q) => {
    state.reportQuery = { ...query, q, page: 0 }
    reloadReports()
  })
  panel.querySelectorAll('[data-case-act]').forEach((btn) => {
    btn.onclick = async () => {
      const act = btn.dataset.caseAct
      const prompts = {
        dismiss: '举报不成立的说明（选填）',
        takedown: '下架原因（必填，作者会看到审核说明）',
        mute_author: '禁言内容作者的原因（必填）',
        ban_author: '封号内容作者的原因（必填）'
      }
      const note = askReason(prompts[act], act !== 'dismiss')
      if (note === null) return
      if (act === 'ban_author' && !window.confirm('确认封号这条内容的作者？（不是举报者）')) return
      btn.disabled = true
      const result = await api('/api/reports/resolve', {
        method: 'POST',
        body: JSON.stringify({ targetType: btn.dataset.type, targetId: btn.dataset.id, action: act, note, muteHours: 24 })
      })
      btn.disabled = false
      if (!result.ok) return alert(result.message || '处理失败')
      reloadReports()
    }
  })
  bindModCommon(panel)
}

// ---------- 举报者档案 ----------

async function openReporter(reporterId, page = 0) {
  const result = await api(`/api/reporters?${qs({ id: reporterId, page })}`)
  if (!result.ok) return alert(result.message || '加载失败')
  const account = result.account || {}
  const stats = result.stats || {}
  const panel = openDrawer(`
    <div class="row"><h3>举报者档案</h3><button type="button" class="quiet" data-drawer-close>关闭</button></div>
    <div class="meta">${esc(account.nickname || '未设昵称')}（${esc(account.id)}）· ${esc(account.schoolName || '未认证')}</div>
    <div class="meta">账号状态 ${esc(ACCOUNT_STATUS_LABEL[account.status] || account.status)} ${accountTag(account)}</div>
    ${account.reportBlocked ? `<div class="meta">限制举报原因：${esc(account.reportBlockedReason || '—')} · ${esc(account.reportBlockedBy || '')} ${formatTime(account.reportBlockedAt)}</div>` : ''}
    <div class="mod-stats">
      <div><strong>${stats.total || 0}</strong><span>举报总数</span></div>
      <div><strong>${stats.upheld || 0}</strong><span>成立</span></div>
      <div><strong>${stats.dismissed || 0}</strong><span>不成立</span></div>
      <div><strong>${stats.pending || 0}</strong><span>待处理</span></div>
    </div>
    <div class="detail-block">
      <div class="field-label">处置这个举报者（人工确认恶意举报后再操作，不影响被举报内容的作者）</div>
      <div class="actions">
        ${account.reportBlocked
          ? '<button type="button" data-reporter-act="unblock_report">恢复举报权限</button>'
          : '<button type="button" data-reporter-act="block_report">限制举报</button>'}
        <button type="button" data-reporter-act="mute">禁言 24 小时</button>
        <button type="button" class="danger-btn" data-reporter-act="ban">封号</button>
        ${account.status && account.status !== 'active' ? '<button type="button" data-reporter-act="restore">解除禁言/封号</button>' : ''}
      </div>
      <p class="meta">限制举报后：他之后提交举报会被拒绝，手上待处理的举报也不再计入自动隐藏人数。</p>
    </div>
    <div class="detail-block">
      <div class="field-label">历史举报</div>
      ${listOrEmpty(result.history, (row) => `
        <div class="list-item compact">
          <div class="row"><strong>${esc(row.targetTitle || row.targetId)}</strong><span class="meta">${esc(row.resolveLabel)}</span></div>
          <div class="meta">${esc(MOD_TYPE_LABEL[row.targetType] || row.targetType)} · ${esc(row.reasonLabel)} · ${formatTime(row.createdAt)}</div>
          ${row.resolveNote ? `<div class="meta">处理说明：${esc(row.resolveNote)}</div>` : ''}
        </div>`)}
      ${pagerHtml(result.total, result.page || 0, result.size, 'data-reporter-page')}
    </div>
  `)
  panel.querySelectorAll('[data-drawer-close]').forEach((el) => { el.onclick = closeDrawer })
  panel.querySelectorAll('[data-reporter-page]').forEach((btn) => {
    btn.onclick = () => openReporter(reporterId, Number(btn.dataset.reporterPage) || 0)
  })
  panel.querySelectorAll('[data-reporter-act]').forEach((btn) => {
    btn.onclick = async () => {
      const act = btn.dataset.reporterAct
      const needReason = ['block_report', 'mute', 'ban'].includes(act)
      const reason = askReason(needReason ? '处置原因（必填，例如：多次恶意举报竞品帖子）' : '备注（选填）', needReason)
      if (reason === null) return
      if (act === 'ban' && !window.confirm(`确认封号举报者 ${account.nickname || account.id}？`)) return
      const result = await api('/api/reporters/restrict', {
        method: 'POST',
        body: JSON.stringify({ reporterId, action: act, reason, muteHours: 24 })
      })
      if (!result.ok) return alert(result.message || '操作失败')
      await openReporter(reporterId, page)
      if (state.nav === 'reports') reloadReports()
    }
  })
}

// ---------- 内容管理 ----------

async function reloadContent() {
  const query = state.contentQuery
  const result = await api(`/api/content?${qs(query)}`)
  state.data.content = result.ok ? result : { error: result.message || '加载失败', items: [] }
  if (state.nav === 'content') render()
}

function contentRowHtml(item) {
  const real = item.realAuthor
  return `
    <div class="card list-item mod-content">
      <div class="row">
        <strong>${esc(item.headline)}</strong>
        <span class="status-pill ${statusClass(item.reviewStatus)}">${esc(item.reviewStatusLabel)}</span>
      </div>
      <div class="meta">
        ${esc(MOD_TYPE_LABEL[item.type])}${item.tag ? ` · ${esc(item.tag)}` : ''} · 作者 ${authorHtml(item.authorName, item.anonymous, real)}${!item.anonymous && real ? `（${esc(real.id)}）` : ''}
        · ${formatTime(item.createdAt)}
      </div>
      ${item.type === 'comment' && item.parent ? `<div class="meta">所属帖子：${esc(item.parent.title)}（${esc(item.parent.statusGroup === 'public' ? '公开' : '未公开')}）</div>` : ''}
      ${item.type === 'comment' && !item.parent ? '<div class="meta">所属帖子已删除</div>' : ''}
      <p class="mod-text clamp">${esc(item.content)}</p>
      ${imagesHtml(item.images)}
      <div class="meta">${item.type === 'comment' ? `点赞 ${item.likeCount}` : `浏览 ${item.viewCount} · 点赞 ${item.likeCount} · 评论 ${item.commentCount}`}</div>
      ${item.takedownReason ? `<div class="meta danger">下架原因：${esc(item.takedownReason)} · ${esc(item.takedownBy)} ${formatTime(item.takedownAt)}</div>` : ''}
      ${item.reportHidden ? '<div class="meta">因举报自动隐藏，等待人工处理</div>' : ''}
      <div class="actions">
        <button type="button" class="quiet" data-content-detail="${esc(item.type)}:${esc(item.id)}">完整内容与上下文</button>
        ${item.statusGroup !== 'removed' ? `<button type="button" class="quiet warn" data-content-act="takedown" data-type="${esc(item.type)}" data-id="${esc(item.id)}">下架</button>` : ''}
        ${item.statusGroup !== 'public' ? `<button type="button" class="quiet" data-content-act="restore" data-type="${esc(item.type)}" data-id="${esc(item.id)}">恢复公开</button>` : ''}
      </div>
    </div>`
}

function renderContent(panel, data) {
  const query = state.contentQuery
  const result = data || { items: [] }
  panel.innerHTML = `
    <div class="card">
      <h3>内容管理</h3>
      <p class="muted">查看全部历史帖子和评论，不用等举报就能下架。下架要写原因，可随时恢复公开；每次操作都记录操作人和原因，并会结束该内容上待处理的举报。</p>
      <div class="chips">${['forum', 'wall', 'comment'].map((type) => `<button type="button" class="chip ${query.type === type ? 'active' : ''}" data-content-type="${type}">${MOD_TYPE_LABEL[type]}</button>`).join('')}</div>
      <div class="chips" style="margin-top:10px">${CONTENT_STATUS_TABS.map((tab) => `<button type="button" class="chip ${query.status === tab.id ? 'active' : ''}" data-content-status="${tab.id}">${tab.label}</button>`).join('')}</div>
      ${searchBarHtml('content-q', query.q, query.type === 'comment' ? '搜索评论内容、作者昵称或账号编号' : '搜索标题、正文、作者昵称或账号编号')}
    </div>
    ${result.error ? `<div class="card danger">${esc(result.error)}</div>` : ''}
    ${listOrEmpty(result.items, contentRowHtml)}
    ${pagerHtml(result.total, result.page || 0, result.size, 'data-content-page')}
  `
  panel.querySelectorAll('[data-content-type]').forEach((btn) => {
    btn.onclick = () => {
      state.contentQuery = { ...query, type: btn.dataset.contentType, page: 0 }
      reloadContent()
    }
  })
  panel.querySelectorAll('[data-content-status]').forEach((btn) => {
    btn.onclick = () => {
      state.contentQuery = { ...query, status: btn.dataset.contentStatus, page: 0 }
      reloadContent()
    }
  })
  panel.querySelectorAll('[data-content-page]').forEach((btn) => {
    btn.onclick = () => {
      state.contentQuery = { ...query, page: Number(btn.dataset.contentPage) || 0 }
      reloadContent()
    }
  })
  bindSearch(panel, 'content-q', (q) => {
    state.contentQuery = { ...query, q, page: 0 }
    reloadContent()
  })
  bindModCommon(panel)
}

async function changeVisibility(type, id, action, after) {
  const reason = askReason(action === 'takedown' ? '下架原因（必填）' : '恢复公开的说明（选填）', action === 'takedown')
  if (reason === null) return
  const result = await api('/api/content/visibility', {
    method: 'POST',
    body: JSON.stringify({ type, id, action, reason })
  })
  if (!result.ok) return alert(result.message || '操作失败')
  if (after) await after()
}

function threadHtml(thread, focusId) {
  if (!thread || !thread.length) return '<p class="meta">还没有评论</p>'
  return thread.map((row) => `
    <div class="list-item compact ${row.id === focusId ? 'mod-focus' : ''}">
      <div class="meta">${authorHtml(row.authorName, row.anonymous, row.realAuthor)}${row.replyToName ? ` 回复 ${esc(row.replyToName)}` : ''} · ${formatTime(row.createdAt)} · <span class="status-pill ${statusClass(row.reviewStatus)}">${esc(row.reviewStatusLabel)}</span></div>
      <div class="mod-text">${esc(row.content)}</div>
      ${imagesHtml(row.images)}
    </div>`).join('')
}

async function openContentDetail(type, id) {
  const result = await api(`/api/content/detail?${qs({ type, id })}`)
  if (!result.ok) return alert(result.message || '加载失败')
  const item = result.item
  const post = result.post
  const real = item.realAuthor
  const panel = openDrawer(`
    <div class="row"><h3>${esc(MOD_TYPE_LABEL[type])}详情</h3><button type="button" class="quiet" data-drawer-close>关闭</button></div>
    <div class="status-pill ${statusClass(item.reviewStatus)}">${esc(item.reviewStatusLabel)}</div>
    ${type !== 'comment' ? `<h3 style="margin-top:12px">${esc(item.headline)}</h3>` : ''}
    <div class="meta">作者 ${authorHtml(item.authorName, item.anonymous, real)}${real ? `（${esc(real.id)}）` : ''} · ${formatTime(item.createdAt)}</div>
    <div class="meta">${type === 'comment' ? `点赞 ${item.likeCount}` : `浏览 ${item.viewCount} · 点赞 ${item.likeCount} · 评论 ${item.commentCount}`}</div>
    <div class="detail-block"><div class="field-label">完整内容</div><div class="detail-text">${esc(item.content || '（无文字）')}</div>${item.extra ? `<div class="detail-text">${esc(item.extra)}</div>` : ''}</div>
    ${imagesHtml(item.images)}
    ${item.takedownReason ? `<div class="meta danger">下架原因：${esc(item.takedownReason)} · ${esc(item.takedownBy)} ${formatTime(item.takedownAt)}</div>` : ''}
    <div class="actions">
      ${item.statusGroup !== 'removed' ? '<button type="button" class="warn" data-detail-act="takedown">下架</button>' : ''}
      ${item.statusGroup !== 'public' ? '<button type="button" data-detail-act="restore">恢复公开</button>' : ''}
    </div>
    ${type === 'comment' ? `
      <div class="detail-block">
        <div class="field-label">所属帖子</div>
        ${post ? `<strong>${esc(post.headline)}</strong>
          <div class="meta">${esc(MOD_TYPE_LABEL[post.type])} · ${authorHtml(post.authorName, post.anonymous, post.realAuthor)} · ${formatTime(post.createdAt)} · <span class="status-pill ${statusClass(post.reviewStatus)}">${esc(post.reviewStatusLabel)}</span></div>
          <div class="detail-text">${esc(post.content)}</div>` : '<p class="meta">原帖已删除</p>'}
      </div>` : ''}
    <div class="detail-block">
      <div class="field-label">${type === 'comment' ? '同帖评论（高亮为当前评论）' : '帖子下的评论'}</div>
      ${threadHtml(result.thread, type === 'comment' ? item.id : '')}
    </div>
    <div class="detail-block">
      <div class="field-label">处置记录</div>
      ${listOrEmpty(result.logs, logRowHtml)}
    </div>
  `)
  panel.querySelectorAll('[data-drawer-close]').forEach((el) => { el.onclick = closeDrawer })
  panel.querySelectorAll('[data-detail-act]').forEach((btn) => {
    btn.onclick = () => changeVisibility(type, id, btn.dataset.detailAct, async () => {
      await openContentDetail(type, id)
      if (state.nav === 'content') reloadContent()
      if (state.nav === 'reports') reloadReports()
    })
  })
}

// ---------- 处置记录 ----------

function logRowHtml(row) {
  return `
    <div class="list-item compact">
      <div class="row">
        <strong>${esc(LOG_ACTION_LABEL[row.action] || row.action || row.type)}</strong>
        <span class="meta">${esc(row.operator || '系统')} · ${formatTime(row.createdAt)}</span>
      </div>
      <div class="meta">${esc(MOD_TYPE_LABEL[row.targetType] || row.targetType)} ${esc(row.targetId)}${row.reason ? ` · 原因：${esc(row.reason)}` : ''}</div>
      <div class="meta">${esc(row.detail)}</div>
    </div>`
}

async function reloadModLogs() {
  const result = await api(`/api/moderation-logs?${qs(state.logQuery)}`)
  state.data.modlogs = result.ok ? result : { error: result.message || '加载失败', items: [] }
  if (state.nav === 'modlogs') render()
}

function renderModLogs(panel, data) {
  const query = state.logQuery
  const result = data || { items: [] }
  panel.innerHTML = `
    <div class="card">
      <h3>处置记录</h3>
      <p class="muted">下架、恢复、举报工单处理、举报者处置、人工审核的操作记录：谁、什么时候、对什么、做了什么、为什么。只显示最近 200 条。</p>
      ${searchBarHtml('log-q', query.q, '搜索操作人、内容编号、账号编号或原因')}
    </div>
    ${result.error ? `<div class="card danger">${esc(result.error)}</div>` : ''}
    <div class="card">${listOrEmpty(result.items, logRowHtml)}</div>
    ${pagerHtml(result.total, result.page || 0, result.size, 'data-log-page')}
  `
  panel.querySelectorAll('[data-log-page]').forEach((btn) => {
    btn.onclick = () => {
      state.logQuery = { ...query, page: Number(btn.dataset.logPage) || 0 }
      reloadModLogs()
    }
  })
  bindSearch(panel, 'log-q', (q) => {
    state.logQuery = { ...query, q, page: 0 }
    reloadModLogs()
  })
}

function bindModCommon(panel) {
  panel.querySelectorAll('[data-reporter]').forEach((btn) => {
    btn.onclick = () => openReporter(btn.dataset.reporter)
  })
  panel.querySelectorAll('[data-content-detail]').forEach((btn) => {
    btn.onclick = () => {
      const [type, id] = btn.dataset.contentDetail.split(':')
      openContentDetail(type, id)
    }
  })
  panel.querySelectorAll('[data-content-act]').forEach((btn) => {
    btn.onclick = () => changeVisibility(btn.dataset.type, btn.dataset.id, btn.dataset.contentAct, reloadContent)
  })
}
