const state = {
  nav: 'overview',
  data: null,
  schoolStatus: 'pending',
  studentStatus: 'pending',
  reviewStatus: 'queue',
  lexiconSignal: 'academic_core',
  weeklyKeyword: '',
  coverDraft: null,
  selectedReview: null,
  reportStatus: 'pending',
  accountQuery: '',
  accountFilter: 'risk',
  whitelistQuery: '',
  officialQuery: '',
  role: 'root',
  staffAccount: ''
}

const titles = {
  overview: ['', '今日概览'],
  review: ['', '内容审核'],
  reports: ['', '内容审核'],
  keywords: ['', '风控词库'],
  accounts: ['', '用户管理'],
  whitelist: ['', '用户管理'],
  official: ['', '用户管理'],
  staff: ['', '后台成员'],
  digest: ['', '公众号推文'],
  weekly: ['', '园区热议'],
  cover: ['', '我的页封面'],
  groups: ['', '企微群发'],
  school: ['', '学校修改审核'],
  student: ['', '学生认证审核'],
  more: ['', '风控日志与反馈']
}

// 合并后的菜单：侧栏只显示第一项，页内用子标签切换；各子页面的数据和接口保持原样
const NAV_GROUPS = {
  review: [
    { nav: 'review', label: '帖子与评论' },
    { nav: 'reports', label: '用户举报' }
  ],
  accounts: [
    { nav: 'accounts', label: '账号处置' },
    { nav: 'whitelist', label: '发帖白名单' },
    { nav: 'official', label: '官方号登录权限' }
  ]
}

function groupOf(nav) {
  return Object.keys(NAV_GROUPS).find((key) => NAV_GROUPS[key].some((item) => item.nav === nav)) || nav
}

function renderSubtabs() {
  const box = document.getElementById('subtabs')
  if (!box) return
  const tabs = NAV_GROUPS[groupOf(state.nav)]
  if (!tabs) {
    box.classList.add('hidden')
    box.innerHTML = ''
    return
  }
  box.classList.remove('hidden')
  box.innerHTML = tabs.map((item) => (
    `<button type="button" data-subnav="${item.nav}" class="${item.nav === state.nav ? 'active' : ''}">${item.label}</button>`
  )).join('')
  box.querySelectorAll('[data-subnav]').forEach((btn) => {
    btn.onclick = async () => {
      if (btn.dataset.subnav === state.nav) return
      state.nav = btn.dataset.subnav
      render()
      await loadNav(state.nav)
    }
  })
}

const TYPE_LABEL = {
  forum: '学习分享',
  wall: '互助广场',
  comment: '评论'
}

async function api(url, options = {}) {
  let res
  try {
    res = await fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    })
  } catch (err) {
    return { ok: false, message: (err && err.message) || '网络请求失败' }
  }
  let data
  try {
    data = await res.json()
  } catch (err) {
    return { ok: false, message: `服务器返回异常(${res.status})` }
  }
  if (res.status === 401 && !url.includes('/api/login') && !url.includes('/api/session')) {
    showLogin()
  }
  return data || { ok: false, message: '服务器无响应' }
}

function showLogin() {
  document.getElementById('login-view').classList.remove('hidden')
  document.getElementById('app-view').classList.add('hidden')
}

function showApp() {
  document.getElementById('login-view').classList.add('hidden')
  document.getElementById('app-view').classList.remove('hidden')
}

function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

// 2026-10 私信下线后取消的联系方式类规则；历史数据里仍会出现这些编号
const RETIRED_RULES = {
  C02: '正文留联系方式',
  A04: '学习类内容留联系方式',
  D02: '文字扫码引流'
}

function ruleText(ids) {
  const list = Array.isArray(ids) ? ids : []
  if (!list.length) return '—'
  return list.map((id) => (RETIRED_RULES[id] ? `${id}（已停用）` : id)).join('、')
}

// 只命中已停用规则的内容：按新规可以直接通过
function retiredOnly(ids) {
  const list = Array.isArray(ids) ? ids : []
  return list.length > 0 && list.every((id) => RETIRED_RULES[id])
}

function retiredHint(ids) {
  return retiredOnly(ids) ? '<span class="retired-hint">只命中已停用规则，按新规可直接通过</span>' : ''
}

// 匿名内容在后台标出来，并给出真实账号（昵称 + u_ 编号）
function authorHtml(name, anonymous, real) {
  if (!anonymous) return esc(name || '—')
  const who = real && real.id
    ? `真实账号 ${esc(real.nickname || '未设昵称')}（${esc(real.id)}）`
    : '真实账号未知'
  return `<span class="anon-tag">匿名</span> ${who}`
}

function esc(text) {
  return String(text || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]))
}

async function render() {
  const [kicker, title] = titles[state.nav]
  document.getElementById('nav-kicker').textContent = kicker
  document.getElementById('nav-title').textContent = title
  document.querySelectorAll('aside nav button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.nav === groupOf(state.nav))
  })
  renderSubtabs()
  const data = state.data || {}
  const panel = document.getElementById('panel')
  const mode = (data.overview && data.overview.mode) || 'local'
  const modeBadge = document.getElementById('mode-badge')
  if (modeBadge) {
    modeBadge.textContent = mode === 'local' ? '本地演示' : '云端数据'
    modeBadge.className = 'mode-badge ' + (mode === 'local' ? 'local' : 'cloud')
  }

  if (state.nav === 'overview') {
    const ov = data.overview || {}
    panel.innerHTML = `
      <div class="stats">
        ${stat(ov.pendingReview, '待审内容')}
        ${stat(ov.emergencyCount, '紧急拦截')}
        ${stat(ov.interceptCount, '已拒绝')}
        ${stat(ov.pendingSchool, '待审学校')}
        ${stat(`${ov.digestCount || 0}/${ov.digestSize || 10}`, '汇总队列')}
        ${stat(ov.bannedCount, '已封禁')}
        ${stat(ov.mutedCount, '禁言中')}
        ${stat(ov.riskLogCount, '风控日志')}
        ${stat(ov.contactFeedbackCount, '联系反馈')}
        ${stat(ov.contactViewCount, '联系查看')}
      </div>
      <div class="card">
        <div class="row">
          <div>
            <h3>内容风控</h3>
            <p class="muted">学习分享 ${ov.forumCount || 0} · 互助广场 ${ov.wallCount || 0} · 评论 ${ov.commentCount || 0}</p>
            <p class="muted">客户群 ${ov.designatedGroups || 0}/${ov.groupCount || 0}</p>
          </div>
          <div class="actions">
            <button id="go-review" type="button">去审核</button>
            ${mode === 'local' ? '<button id="reset-local" class="ghost" type="button">重置演示数据</button>' : ''}
          </div>
        </div>
      </div>
      <div class="card">
        <h3>待处理预览</h3>
        ${listOrEmpty((data.reviews || []).slice(0, 5), (item) => `
          <div class="list-item compact">
            <div class="row">
              <strong>${esc(item.headline || '')}</strong>
              <span class="status-pill ${statusClass(item.reviewStatus)}">${esc(item.reviewStatusLabel || item.reviewStatus || '')}</span>
            </div>
            <div class="meta">${esc(TYPE_LABEL[item.contentType] || item.contentType)} · ${esc(item.channel || '')} · 规则 ${esc(ruleText(item.reviewRuleIds))}</div>${retiredHint(item.reviewRuleIds)}
          </div>`)}
      </div>`
    panel.querySelector('#go-review').onclick = () => {
      state.nav = 'review'
      state.reviewStatus = 'queue'
      render()
      loadNav('review')
    }
    const resetBtn = panel.querySelector('#reset-local')
    if (resetBtn) {
      resetBtn.onclick = async () => {
        if (!window.confirm('重置本地演示审帖数据？')) return
        const result = await api('/api/local/reset', { method: 'POST', body: '{}' })
        alert(result.message || (result.ok ? '已重置' : '失败'))
        await reload()
      }
    }
    return
  }

  if (state.nav === 'review') {
    const statuses = [
      ['queue', '待处理'],
      ['manual_review', '人工审核'],
      ['pending', '待审核'],
      ['edit_required', '需修改'],
      ['emergency_block', '紧急拦截'],
      ['rejected', '已拒绝'],
      ['approved', '已通过'],
      ['全部', '全部']
    ]
    const reviews = data.reviews || []
    panel.innerHTML = `
      <div class="review-layout">
        <div class="review-list">
          <div class="chips sticky-chips">
            ${statuses.map(([id, label]) => `<button class="chip ${state.reviewStatus === id ? 'active' : ''}" data-rstatus="${id}">${label}</button>`).join('')}
          </div>
          ${listOrEmpty(reviews, (item) => `
            <button class="review-card ${state.selectedReview && state.selectedReview.id === item.id ? 'active' : ''}" data-open-type="${esc(item.contentType)}" data-open-id="${esc(item.id)}" type="button">
              <div class="row">
                <strong>${item.anonymous ? '<span class="anon-tag">匿名</span> ' : ''}${esc(item.headline || '')}</strong>
                <span class="status-pill ${statusClass(item.reviewStatus)}">${esc(item.reviewStatusLabel || '')}${item.reviewPriority === 'high' ? ' · 优先' : ''}</span>
              </div>
              <div class="meta">${esc(TYPE_LABEL[item.contentType] || '')} · ${esc(item.channel || '')} · ${formatTime(item.createdAt)}</div>
              <div class="snippet">${esc(String(item.content || '').slice(0, 90))}</div>
              <div class="meta">${esc(retiredOnly(item.reviewRuleIds) ? '规则 ' + ruleText(item.reviewRuleIds) : (item.reviewNote || '规则 ' + ruleText(item.reviewRuleIds)))}</div>${retiredHint(item.reviewRuleIds)}
            </button>`)}
        </div>
        <div class="review-detail card" id="review-detail">
          <div class="empty">从左侧选择一条内容开始审核</div>
        </div>
      </div>`
    panel.querySelectorAll('[data-rstatus]').forEach((btn) => {
      btn.onclick = async () => {
        state.reviewStatus = btn.dataset.rstatus
        state.selectedReview = null
        const result = await api(`/api/reviews?status=${encodeURIComponent(state.reviewStatus)}`)
        state.data.reviews = result.list || []
        render()
      }
    })
    panel.querySelectorAll('[data-open-id]').forEach((btn) => {
      btn.onclick = async () => {
        const result = await api(`/api/reviews/detail?type=${encodeURIComponent(btn.dataset.openType)}&id=${encodeURIComponent(btn.dataset.openId)}`)
        if (!result.ok) return alert(result.message || '加载失败')
        state.selectedReview = result.item
        renderReviewDetail(panel.querySelector('#review-detail'), result.item)
        panel.querySelectorAll('.review-card').forEach((card) => {
          card.classList.toggle('active', card.dataset.openId === btn.dataset.openId)
        })
      }
    })
    if (state.selectedReview) {
      const still = reviews.find((item) => item.id === state.selectedReview.id)
      if (still) {
        const result = await api(`/api/reviews/detail?type=${encodeURIComponent(state.selectedReview.contentType)}&id=${encodeURIComponent(state.selectedReview.id)}`)
        if (result.ok) {
          state.selectedReview = result.item
          renderReviewDetail(panel.querySelector('#review-detail'), result.item)
        }
      } else {
        state.selectedReview = null
      }
    }
    return
  }

  if (state.nav === 'keywords') {
    const lex = data.lexicons || { rows: [], types: [], meta: {} }
    const types = lex.types || []
    const rows = (lex.rows || []).filter((item) => !state.lexiconSignal || item.signal === state.lexiconSignal)
    panel.innerHTML = `
      <div class="card">
        <h3>本地词库</h3>
        <p class="muted">词库是信号，不是禁词表。命中单个词/缩写不能直接拒绝，必须按组合规则判断。当前版本 ${esc((lex.meta && lex.meta.version) || 1)}</p>
        <div class="chips">
          ${types.map((item) => `<button class="chip ${state.lexiconSignal === item.id ? 'active' : ''}" data-signal="${esc(item.id)}">${esc(item.label)}</button>`).join('')}
        </div>
        <label class="field-label">新增词条到「${esc((types.find((t) => t.id === state.lexiconSignal) || {}).label || state.lexiconSignal)}」</label>
        <div class="row gap">
          <input id="lexicon-input" placeholder="例如：代刷课" />
          <button id="add-lexicon" type="button">添加</button>
        </div>
        <div class="chips" style="margin-top:16px">
          ${rows.map((item) => `<button class="chip ${item.enabled === false ? '' : 'active'}" data-lex="${esc(item.id)}">${esc(item.word)}${item.enabled === false ? ' · 停用' : ''}${item.locked ? '' : ' ×'}</button>`).join('') || '<span class="muted">暂无词条</span>'}
        </div>
      </div>
      <div class="card">
        <h3>旧版关键词（兼容）</h3>
        <p class="muted">不再作为直接拒绝依据，仅保留检索兼容。</p>
        <div class="row gap">
          <input id="keyword-input" placeholder="例如：刷单" />
          <button id="add-keyword" type="button">添加</button>
        </div>
        <div class="chips" style="margin-top:16px">
          ${(data.keywords || []).map((item) => `<button class="chip" data-word="${esc(item.word)}" ${item.locked ? 'disabled' : ''}>${esc(item.word)}${item.locked ? ' · 锁定' : ' ×'}</button>`).join('')}
        </div>
      </div>`
    panel.querySelectorAll('[data-signal]').forEach((btn) => {
      btn.onclick = () => {
        state.lexiconSignal = btn.dataset.signal
        render()
      }
    })
    panel.querySelector('#add-lexicon').onclick = async () => {
      const word = panel.querySelector('#lexicon-input').value
      const result = await api('/api/lexicons', { method: 'POST', body: JSON.stringify({ signal: state.lexiconSignal, word }) })
      if (!result.ok) return alert(result.message)
      state.data.lexicons = { rows: result.rows, types: result.types, meta: result.meta }
      render()
    }
    panel.querySelectorAll('[data-lex]').forEach((btn) => {
      btn.onclick = async () => {
        const row = (lex.rows || []).find((item) => item.id === btn.dataset.lex)
        if (!row) return
        if (!row.locked && window.confirm(`删除「${row.word}」？`)) {
          const result = await api('/api/lexicons', { method: 'DELETE', body: JSON.stringify({ id: row.id }) })
          if (!result.ok) return alert(result.message)
          state.data.lexicons = { rows: result.rows, types: result.types, meta: result.meta }
          render()
          return
        }
        const result = await api('/api/lexicons/toggle', { method: 'POST', body: JSON.stringify({ id: row.id, enabled: row.enabled === false }) })
        if (!result.ok) return alert(result.message)
        state.data.lexicons = { rows: result.rows, types: result.types, meta: result.meta }
        render()
      }
    })
    panel.querySelector('#add-keyword').onclick = async () => {
      const word = panel.querySelector('#keyword-input').value
      const result = await api('/api/keywords', { method: 'POST', body: JSON.stringify({ word }) })
      if (!result.ok) return alert(result.message)
      await reload()
    }
    panel.querySelectorAll('.chip[data-word]:not([disabled])').forEach((btn) => {
      btn.onclick = async () => {
        const result = await api('/api/keywords', { method: 'DELETE', body: JSON.stringify({ word: btn.dataset.word }) })
        if (!result.ok) return alert(result.message)
        await reload()
      }
    })
    return
  }

  if (state.nav === 'accounts') {
    const query = String(state.accountQuery || '').trim()
    const filter = state.accountFilter || 'risk'
    const accounts = (query && Array.isArray(state.accountHits) ? state.accountHits : (data.accounts || [])).filter((item) => {
      if (query && Array.isArray(state.accountHits)) return true
      if (filter === 'whitelist' && !item.postWhitelist) return false
      if (filter === 'admin' && !item.appAdmin) return false
      if (filter === 'muted' && !(item.status === 'muted' && item.muteUntil > Date.now())) return false
      if (filter === 'banned' && item.status !== 'banned') return false
      if (filter === 'risk' && !((item.riskScore || 0) > 0 || (item.violateCount || 0) > 0 || item.status === 'banned' || item.status === 'muted')) return false
      return true
    })
    panel.innerHTML = `
      <div class="card">
        <h3>账号处置</h3>
        <p class="muted">加白名单、设管理员、禁言和封禁，都用小程序「我的」里的账号编号。编号每人一条，不会因为昵称重复或没改昵称而对错人。把编号贴到下面搜索。</p>
        <div class="row gap">
          <input id="account-query" placeholder="贴账号编号，例如 u_ 开头" value="${esc(query)}" />
          <button id="account-search" type="button">搜索</button>
        </div>
        <div class="chips">
          ${[['risk', '需关注'], ['admin', '小程序管理员'], ['whitelist', '发帖白名单'], ['muted', '禁言中'], ['banned', '已封禁'], ['all', '全部']].map(([id, label]) => `<button class="chip ${filter === id ? 'active' : ''}" data-afilter="${id}" type="button">${label}</button>`).join('')}
        </div>
      </div>
      ${listOrEmpty(accounts, (item) => `
        <div class="card list-item">
          <div class="row"><strong>${esc(item.nickname)}</strong><span>${item.appAdmin ? '小程序管理员' : (item.postWhitelist ? '发帖白名单' : statusText(item))}</span></div>
          <div class="meta">账号编号 ${esc(item.id || '')}</div>
          <div class="meta">${esc([item.schoolName, item.schoolCampus].filter(Boolean).join(' · ') || '未认证')}</div>
          <div class="meta">风险 ${item.riskScore || 0} · 违规 ${item.violateCount || 0}${item.banReason ? ` · ${esc(item.banReason)}` : ''}</div>
          <div class="actions">
            <button data-act="mute" data-id="${esc(item.id)}">禁言 24h</button>
            <button data-act="mute7" data-id="${esc(item.id)}">禁言 7 天</button>
            <button data-act="ban" data-id="${esc(item.id)}">封禁</button>
            <button data-act="unban" data-id="${esc(item.id)}">解除</button>
            <button data-act="whitelist" data-id="${esc(item.id)}" data-on="${item.postWhitelist ? '1' : '0'}">${item.postWhitelist ? '取消发帖白名单' : '设为发帖白名单'}</button>
            <button data-act="official" data-id="${esc(item.id)}" data-on="${item.officialLoginAllowed ? '1' : '0'}">${item.officialLoginAllowed ? '取消官方登录' : '允许登录官方账号'}</button>
            <button data-act="appadmin" data-id="${esc(item.id)}" data-on="${item.appAdmin ? '1' : '0'}">${item.appAdmin ? '取消小程序管理员' : '设为小程序管理员'}</button>
            <button data-act="school" data-id="${esc(item.id)}">改学校</button>
          </div>
        </div>`)}
      <div class="card">
        <h3>已拒绝和紧急拦截</h3>
        ${listOrEmpty(data.intercepts, (item) => `
          <div class="list-item">
            <div class="row"><strong>${esc(item.headline)}</strong><span class="danger">${esc(item.reviewStatusLabel || '已拦截')}</span></div>
            <div class="meta">${esc(TYPE_LABEL[item.contentType] || '')} · ${esc(item.channel || '')} · ${formatTime(item.createdAt)}</div>
            <div class="meta">${esc(item.reviewNote || '')} · 规则 ${esc(ruleText(item.reviewRuleIds))}</div>${retiredHint(item.reviewRuleIds)}
          </div>`)}
      </div>`
    const search = panel.querySelector('#account-search')
    const input = panel.querySelector('#account-query')
    const runAccountSearch = async () => {
      state.accountQuery = input.value.trim()
      if (!state.accountQuery) {
        state.accountHits = null
        render()
        return
      }
      const result = await api('/api/accounts/search?q=' + encodeURIComponent(state.accountQuery))
      if (!result.ok) return alert(result.message || '没有找到这个账号编号')
      state.accountHits = result.list || []
      render()
    }
    search.onclick = runAccountSearch
    input.onkeydown = (e) => {
      if (e.key !== 'Enter') return
      runAccountSearch()
    }
    panel.querySelectorAll('[data-afilter]').forEach((btn) => {
      btn.onclick = () => {
        state.accountFilter = btn.dataset.afilter
        render()
      }
    })
    panel.querySelectorAll('[data-act]').forEach((btn) => {
      btn.onclick = async () => {
        if (btn.dataset.act === 'whitelist') {
          const result = await api('/api/accounts/whitelist', {
            method: 'POST',
            body: JSON.stringify({ id: btn.dataset.id, enabled: btn.dataset.on !== '1' })
          })
          if (!result.ok) return alert(result.message || '失败')
          const fresh = await api('/api/accounts')
          if (fresh.ok) state.data.accounts = fresh.list || []
          if (state.accountQuery) {
            const found = await api('/api/accounts/search?q=' + encodeURIComponent(state.accountQuery))
            if (found.ok) state.accountHits = found.list || []
          }
          render()
          return
        }
        if (btn.dataset.act === 'official') {
          const result = await api('/api/accounts/official-login', {
            method: 'POST',
            body: JSON.stringify({ id: btn.dataset.id, enabled: btn.dataset.on !== '1' })
          })
          alert(result.ok ? (result.message || '已更新') : (result.message || '失败'))
          if (!result.ok) return
          const fresh = await api('/api/accounts')
          if (fresh.ok) state.data.accounts = fresh.list || []
          if (state.accountQuery) {
            const found = await api('/api/accounts/search?q=' + encodeURIComponent(state.accountQuery))
            if (found.ok) state.accountHits = found.list || []
          }
          render()
          return
        }
        if (btn.dataset.act === 'school') {
          const schoolName = window.prompt('学校全称', '')
          if (schoolName === null) return
          const schoolCampus = window.prompt('校区，没有就留空', '')
          if (schoolCampus === null) return
          const result = await api('/api/school/set', {
            method: 'POST',
            body: JSON.stringify({ id: btn.dataset.id, schoolName, schoolCampus })
          })
          alert(result.ok ? (result.message || '已更新') : (result.message || '失败'))
          if (!result.ok) return
          if (state.accountQuery) {
            const found = await api('/api/accounts/search?q=' + encodeURIComponent(state.accountQuery))
            if (found.ok) state.accountHits = found.list || []
          }
          const fresh = await api('/api/accounts')
          if (fresh.ok) state.data.accounts = fresh.list || []
          render()
          return
        }
        if (btn.dataset.act === 'appadmin') {
          const result = await api('/api/accounts/app-admin', {
            method: 'POST',
            body: JSON.stringify({ id: btn.dataset.id, enabled: btn.dataset.on !== '1' })
          })
          alert(result.ok ? (result.message || '已更新') : (result.message || '失败'))
          if (!result.ok) return
          const fresh = await api('/api/accounts')
          if (fresh.ok) state.data.accounts = fresh.list || []
          if (state.accountQuery) {
            const found = await api('/api/accounts/search?q=' + encodeURIComponent(state.accountQuery))
            if (found.ok) state.accountHits = found.list || []
          } else {
            state.accountFilter = 'admin'
          }
          render()
          return
        }
        const map = {
          mute: { status: 'muted', muteHours: 24, reason: '管理员禁言 24 小时' },
          mute7: { status: 'muted', muteHours: 168, reason: '管理员禁言 7 天' },
          ban: { status: 'banned', reason: '管理员封禁该账号' },
          unban: { status: 'active', reason: '' }
        }
        const chosen = map[btn.dataset.act]
        const reason = window.prompt('处置原因', chosen.reason)
        if (reason === null) return
        const result = await api('/api/accounts/status', {
          method: 'POST',
          body: JSON.stringify({ id: btn.dataset.id, status: chosen.status, muteHours: chosen.muteHours, reason })
        })
        if (!result.ok) return alert(result.message)
        const fresh = await api('/api/accounts')
        if (fresh.ok) state.data.accounts = fresh.list || []
        if (state.accountQuery) {
          const found = await api('/api/accounts/search?q=' + encodeURIComponent(state.accountQuery))
          if (found.ok) state.accountHits = found.list || []
        }
        render()
      }
    })
    return
  }

  if (state.nav === 'whitelist') {
    const query = String(state.whitelistQuery || '').trim()
    const members = data.whitelist || []
    const hits = data.whitelistHits || []
    panel.innerHTML = `
      <div class="card">
        <h3>发帖白名单</h3>
        <p class="muted">用小程序「我的」里的账号编号加人。点那一行可以复制，编号以 u_ 开头。昵称可以重复，不要用昵称认人。</p>
        <div class="row gap">
          <input id="whitelist-query" placeholder="贴账号编号，例如 u_ 开头" value="${esc(query)}" />
          <button id="whitelist-search" type="button">搜索</button>
        </div>
      </div>
      ${query ? `<div class="card"><h3>搜索结果</h3>${listOrEmpty(hits, (item) => `
        <div class="list-item">
          <div class="row"><strong>${esc(item.nickname || '黎安话事')}</strong><span>${item.postWhitelist ? '已在白名单' : '未加入'}</span></div>
          <div class="meta">账号编号 ${esc(item.id || '')}</div>
          <div class="meta">${esc([item.schoolName, item.schoolCampus].filter(Boolean).join(' · ') || '未认证')}</div>
          <div class="actions">
            <button type="button" data-wl="${esc(item.id)}" data-on="${item.postWhitelist ? '1' : '0'}">${item.postWhitelist ? '移出白名单' : '加入白名单'}</button>
          </div>
        </div>`)}</div>` : ''}
      <div class="card">
        <h3>当前名单 ${members.length}</h3>
        ${listOrEmpty(members, (item) => `
          <div class="list-item">
            <div class="row"><strong>${esc(item.nickname || '黎安话事')}</strong><span>发帖白名单</span></div>
            <div class="meta">账号编号 ${esc(item.id || '')}</div>
            <div class="meta">${esc([item.schoolName, item.schoolCampus].filter(Boolean).join(' · ') || '未认证')}</div>
            <div class="actions">
              <button type="button" data-wl="${esc(item.id)}" data-on="1">移出白名单</button>
            </div>
          </div>`)}
      </div>`
    const input = panel.querySelector('#whitelist-query')
    const search = async () => {
      state.whitelistQuery = input.value.trim()
      if (!state.whitelistQuery) {
        state.data.whitelistHits = []
        render()
        return
      }
      const result = await api('/api/accounts/search?q=' + encodeURIComponent(state.whitelistQuery))
      if (!result.ok) return alert(result.message || '搜索失败')
      state.data.whitelistHits = result.list || []
      render()
    }
    panel.querySelector('#whitelist-search').onclick = search
    input.onkeydown = (e) => {
      if (e.key === 'Enter') search()
    }
    panel.querySelectorAll('[data-wl]').forEach((btn) => {
      btn.onclick = async () => {
        const result = await api('/api/accounts/whitelist', {
          method: 'POST',
          body: JSON.stringify({ id: btn.dataset.wl, enabled: btn.dataset.on !== '1' })
        })
        if (!result.ok) return alert(result.message || '失败')
        await loadNav('whitelist')
      }
    })
    return
  }

  if (state.nav === 'official') {
    const query = String(state.officialQuery || '').trim()
    const members = data.official || []
    const hits = data.officialHits || []
    panel.innerHTML = `
      <div class="card">
        <h3>登录黎安校园墙</h3>
        <p class="muted">只有这里加入的账号编号，才能在小程序「我的」里登录黎安校园墙。其他人没有这个入口。把小程序里复制的 u_ 编号贴到下面。</p>
        <div class="row gap">
          <input id="official-query" placeholder="贴账号编号，例如 u_ 开头" value="${esc(query)}" />
          <button id="official-search" type="button">搜索</button>
        </div>
      </div>
      ${query ? `<div class="card"><h3>搜索结果</h3>${listOrEmpty(hits, (item) => `
        <div class="list-item">
          <div class="row"><strong>${esc(item.nickname || '黎安话事')}</strong><span>${item.officialLoginAllowed ? '可以登录' : '未授权'}</span></div>
          <div class="meta">账号编号 ${esc(item.id || '')}</div>
          <div class="meta">${esc([item.schoolName, item.schoolCampus].filter(Boolean).join(' · ') || '未认证')}</div>
          <div class="actions">
            <button type="button" data-official="${esc(item.id)}" data-on="${item.officialLoginAllowed ? '1' : '0'}">${item.officialLoginAllowed ? '取消权限' : '允许登录'}</button>
          </div>
        </div>`)}</div>` : ''}
      <div class="card">
        <h3>当前可登录 ${members.length}</h3>
        ${listOrEmpty(members, (item) => `
          <div class="list-item">
            <div class="row"><strong>${esc(item.nickname || '黎安话事')}</strong><span>可以登录官方账号</span></div>
            <div class="meta">账号编号 ${esc(item.id || '')}</div>
            <div class="meta">${esc([item.schoolName, item.schoolCampus].filter(Boolean).join(' · ') || '未认证')}</div>
            <div class="actions">
              <button type="button" data-official="${esc(item.id)}" data-on="1">取消权限</button>
            </div>
          </div>`)}
      </div>`
    const input = panel.querySelector('#official-query')
    const search = async () => {
      state.officialQuery = input.value.trim()
      if (!state.officialQuery) {
        state.data.officialHits = []
        render()
        return
      }
      const result = await api('/api/accounts/search?q=' + encodeURIComponent(state.officialQuery))
      if (!result.ok) return alert(result.message || '搜索失败')
      state.data.officialHits = result.list || []
      render()
    }
    panel.querySelector('#official-search').onclick = search
    input.onkeydown = (e) => {
      if (e.key === 'Enter') search()
    }
    panel.querySelectorAll('[data-official]').forEach((btn) => {
      btn.onclick = async () => {
        const result = await api('/api/accounts/official-login', {
          method: 'POST',
          body: JSON.stringify({ id: btn.dataset.official, enabled: btn.dataset.on !== '1' })
        })
        if (!result.ok) return alert(result.message || '失败')
        await loadNav('official')
      }
    })
    return
  }

  if (state.nav === 'staff') {
    const isRoot = state.role !== 'staff'
    const people = data.staff || []
    panel.innerHTML = `
      <div class="card">
        <h3>${isRoot ? '给学生运营开账号' : '修改我的密码'}</h3>
        <p class="muted">${isRoot ? '子账号可以登录这个审核后台审帖、处理举报。可以改密码、停用，也可以直接删除。主管理员账号仍是服务器上的那个，不在这里改。' : '停用或删除后这个账号就不能再登录。'}</p>
        ${isRoot ? `
          <label class="field-label">登录账号</label><input id="staff-account" placeholder="例如 operator01" />
          <label class="field-label">显示名字</label><input id="staff-name" placeholder="例如 学生运营-小王" />
          <label class="field-label">初始密码</label><input id="staff-password" type="password" placeholder="至少 6 位" />
          <button id="staff-create" type="button" style="margin-top:16px">创建运营账号</button>
        ` : `
          <label class="field-label">新密码</label><input id="my-password" type="password" placeholder="至少 6 位" />
          <button id="my-password-btn" type="button" style="margin-top:16px">保存新密码</button>
        `}
      </div>
      ${isRoot ? listOrEmpty(people, (item) => `
        <div class="card list-item">
          <div class="row"><strong>${esc(item.name || item.account)}</strong><span>${item.status === 'disabled' ? '已停用' : '使用中'}</span></div>
          <div class="meta">登录账号 ${esc(item.account)}</div>
          <div class="actions">
            <button type="button" data-staff-password="${esc(item.account)}">修改密码</button>
            <button type="button" data-staff-status="${esc(item.account)}" data-next="${item.status === 'disabled' ? 'active' : 'disabled'}">${item.status === 'disabled' ? '恢复' : '停用'}</button>
            <button type="button" data-staff-delete="${esc(item.account)}">删除</button>
          </div>
        </div>`) : ''}
      <div class="card">
        <h3>小程序官方发帖号</h3>
        <p class="muted">运营要共用一个微信号登录小程序、把朋友圈内容批量发到互助广场或学习分享。先让这个微信号登录一次小程序，打开「我的」复制账号编号，再到左侧「用户管理 › 发帖白名单」里贴上编号，点加入。白名单号不受 10 分钟 5 条、每天 15 条的发帖限制，也不会因为短时间重复内容被拦住。内容审核仍然会走。</p>
      </div>`
    const createBtn = panel.querySelector('#staff-create')
    if (createBtn) {
      createBtn.onclick = async () => {
        const result = await api('/api/staff', {
          method: 'POST',
          body: JSON.stringify({
            account: panel.querySelector('#staff-account').value,
            name: panel.querySelector('#staff-name').value,
            password: panel.querySelector('#staff-password').value
          })
        })
        if (!result.ok) return alert(result.message || '创建失败')
        await loadNav('staff')
      }
    }
    const mineBtn = panel.querySelector('#my-password-btn')
    if (mineBtn) {
      mineBtn.onclick = async () => {
        const result = await api('/api/staff/password', {
          method: 'POST',
          body: JSON.stringify({
            account: state.staffAccount,
            password: panel.querySelector('#my-password').value
          })
        })
        alert(result.ok ? '密码已更新' : (result.message || '失败'))
      }
    }
    panel.querySelectorAll('[data-staff-password]').forEach((btn) => {
      btn.onclick = async () => {
        const password = window.prompt(`给 ${btn.dataset.staffPassword} 设置新密码`, '')
        if (!password) return
        const result = await api('/api/staff/password', {
          method: 'POST',
          body: JSON.stringify({ account: btn.dataset.staffPassword, password })
        })
        alert(result.ok ? '密码已更新' : (result.message || '失败'))
      }
    })
    panel.querySelectorAll('[data-staff-status]').forEach((btn) => {
      btn.onclick = async () => {
        const result = await api('/api/staff/status', {
          method: 'POST',
          body: JSON.stringify({ account: btn.dataset.staffStatus, status: btn.dataset.next })
        })
        if (!result.ok) return alert(result.message || '失败')
        await loadNav('staff')
      }
    })
    panel.querySelectorAll('[data-staff-delete]').forEach((btn) => {
      btn.onclick = async () => {
        const account = btn.dataset.staffDelete
        if (!window.confirm(`删除运营账号「${account}」？删除后不能再登录。`)) return
        const result = await api('/api/staff/delete', {
          method: 'POST',
          body: JSON.stringify({ account })
        })
        if (!result.ok) return alert(result.message || '删除失败')
        await loadNav('staff')
      }
    })
    return
  }

  if (state.nav === 'reports') {
    const allCases = data.reports || []
    const filter = state.reportStatus || 'pending'
    const cases = allCases.filter((item) => filter === '全部' || item.status === filter)
    const typeLabel = { forum: '学习分享', wall: '互助广场', comment: '评论', user: '用户' }
    const actLabel = { hide: '已隐藏', delete: '已下架', mute: '已禁言', ban: '已封号', dismiss: '已忽略' }
    panel.innerHTML = `
      <div class="card">
        <h3>举报工单</h3>
        <p class="muted">按被举报对象合并。同一帖或同一用户被 3 个不同的人举报后，帖子会自动隐藏并进入审帖。这里可以看原文、处理，并留下记录。</p>
        <div class="row gap">
          <button type="button" data-report-filter="pending">待处理 ${allCases.filter((item) => item.status === 'pending').length}</button>
          <button type="button" data-report-filter="resolved">已处理 ${allCases.filter((item) => item.status === 'resolved').length}</button>
          <button type="button" data-report-filter="全部">全部 ${allCases.length}</button>
        </div>
      </div>
      ${listOrEmpty(cases, (item) => `
        <div class="card list-item">
          <div class="row">
            <strong>${esc(item.title || '未命名')}</strong>
            <span>${esc(typeLabel[item.targetType] || item.targetType)} · ${item.reportCount || 0} 人举报</span>
          </div>
          <div class="meta">作者 ${authorHtml(item.authorName || item.targetAuthorId, item.anonymous, item.realAuthor)} · 最近 ${formatTime(item.latestAt)}${item.reviewStatus ? ` · 内容状态 ${esc(item.reviewStatus)}` : ''}</div>
          ${item.content ? `<p>${esc(item.content)}</p>` : ''}
          ${item.images && item.images.length ? `<div class="image-row">${item.images.map((src) => `<a href="${esc(src)}" target="_blank" rel="noreferrer"><img class="thumb" src="${esc(src)}" alt=""></a>`).join('')}</div>` : ''}
          ${(item.reports || []).map((report) => `
            <div class="list-item">
              <div class="row"><strong>${esc(report.reasonLabel || report.reason)}</strong><span>${esc(report.status === 'pending' ? '待处理' : (actLabel[report.resolveAction] || '已处理'))}</span></div>
              <div class="meta">${esc(report.reporterName || report.reporterId)} · ${formatTime(report.createdAt)}</div>
              ${report.note ? `<div class="meta">补充：${esc(report.note)}</div>` : ''}
              ${report.resolveNote || report.resolvedAt ? `<div class="meta">处理：${esc(report.resolveNote || actLabel[report.resolveAction] || '')} · ${formatTime(report.resolvedAt)}</div>` : ''}
              ${report.status === 'pending' ? `
                <div class="actions">
                  <button data-rid="${esc(report.id)}" data-act="hide">隐藏进审</button>
                  <button data-rid="${esc(report.id)}" data-act="delete">下架删除</button>
                  <button data-rid="${esc(report.id)}" data-act="mute">禁言作者</button>
                  <button data-rid="${esc(report.id)}" data-act="ban">封号作者</button>
                  <button data-rid="${esc(report.id)}" data-act="dismiss">忽略</button>
                </div>` : ''}
            </div>`).join('')}
        </div>`)}
    `
    panel.querySelectorAll('[data-report-filter]').forEach((btn) => {
      btn.onclick = () => {
        state.reportStatus = btn.dataset.reportFilter
        render()
      }
    })
    panel.querySelectorAll('[data-rid]').forEach((btn) => {
      btn.onclick = async () => {
        const note = window.prompt('处理备注（可选）', '') || ''
        const result = await api('/api/reports/resolve', {
          method: 'POST',
          body: JSON.stringify({ id: btn.dataset.rid, action: btn.dataset.act, note, muteHours: 24 })
        })
        if (!result.ok) return alert(result.message || '处理失败')
        await reload()
      }
    })
    return
  }

  if (state.nav === 'cover') {
    renderCover(panel, data.cover)
    return
  }

  if (state.nav === 'weekly') {
    const weekly = data.weeklyHot || { board: { items: [] }, candidates: [], max: 20 }
    const board = weekly.board || { enabled: true, items: [] }
    panel.innerHTML = `
      <div class="card">
        <h3>园区热议</h3>
        <p class="muted">小程序首页的「园区热议」卡片和榜单页。管理员决定上架内容与排序；与群发汇总推送互不影响。标题在小程序里固定为「园区热议」，这里不用设置。</p>
        <div class="row gap weekly-switch">
          <label class="check-row"><input id="weekly-enabled" type="checkbox" ${board.enabled ? 'checked' : ''}/><span>在小程序里展示</span></label>
          <button id="weekly-save-meta" type="button">保存</button>
        </div>
        <p class="muted">当前 ${board.items.length || 0} / ${weekly.max || 20} 条</p>
      </div>
      <div class="card">
        <h3>当前热榜顺序</h3>
        ${listOrEmpty(board.items, (item) => `
          <div class="hot-row">
            <span class="hot-rank">${item.rank}</span>
            <div class="hot-copy">
              <strong>${esc(item.title)}</strong>
              <span class="meta">${item.contentType === 'forum' ? '学习分享' : '互助广场'}${item.tag ? ' · ' + esc(item.tag) : ''}</span>
            </div>
            <div class="hot-ops">
              <button class="quiet" data-weekly-move="up" data-id="${esc(item.contentId)}" data-type="${esc(item.contentType || 'wall')}" type="button">上移</button>
              <button class="quiet" data-weekly-move="down" data-id="${esc(item.contentId)}" data-type="${esc(item.contentType || 'wall')}" type="button">下移</button>
              <button class="quiet warn" data-weekly-remove="${esc(item.contentId)}" data-type="${esc(item.contentType || 'wall')}" type="button">移除</button>
            </div>
          </div>`)}
      </div>
      <div class="card">
        <h3>添加学习分享 / 互助广场内容</h3>
        <div class="row gap">
          <input id="weekly-keyword" placeholder="搜索标题/正文" value="${esc(state.weeklyKeyword)}" />
          <button id="weekly-search" type="button">搜索</button>
        </div>
        ${listOrEmpty(weekly.candidates, (item) => `
          <div class="hot-row">
            <div class="hot-copy">
              <strong>${esc(item.title)}</strong>
              <span class="meta">${item.contentType === 'forum' ? '学习分享' : '互助广场'}${item.tag ? ' · ' + esc(item.tag) : ''}</span>
            </div>
            <button class="quiet" data-weekly-add="${esc(item.id)}" data-type="${esc(item.contentType || 'wall')}" type="button">加入热榜</button>
          </div>`)}
      </div>`
    panel.querySelector('#weekly-save-meta').onclick = async () => {
      const result = await api('/api/weekly-hot/meta', {
        method: 'POST',
        body: JSON.stringify({
          enabled: panel.querySelector('#weekly-enabled').checked
        })
      })
      if (!result.ok) return alert(result.message || '保存失败')
      await reloadWeekly()
    }
    panel.querySelector('#weekly-search').onclick = async () => {
      state.weeklyKeyword = panel.querySelector('#weekly-keyword').value
      await reloadWeekly()
    }
    panel.querySelectorAll('[data-weekly-add]').forEach((btn) => {
      btn.onclick = async () => {
        const result = await api('/api/weekly-hot/add', {
          method: 'POST',
          body: JSON.stringify({ contentId: btn.dataset.weeklyAdd, contentType: btn.dataset.type || 'wall' })
        })
        if (!result.ok) return alert(result.message || '添加失败')
        await reloadWeekly()
      }
    })
    panel.querySelectorAll('[data-weekly-remove]').forEach((btn) => {
      btn.onclick = async () => {
        const result = await api('/api/weekly-hot/remove', {
          method: 'POST',
          body: JSON.stringify({ contentId: btn.dataset.weeklyRemove, contentType: btn.dataset.type || 'wall' })
        })
        if (!result.ok) return alert(result.message || '移除失败')
        await reloadWeekly()
      }
    })
    panel.querySelectorAll('[data-weekly-move]').forEach((btn) => {
      btn.onclick = async () => {
        const result = await api('/api/weekly-hot/move', {
          method: 'POST',
          body: JSON.stringify({
            contentId: btn.dataset.id,
            direction: btn.dataset.weeklyMove,
            contentType: btn.dataset.type || 'wall'
          })
        })
        if (!result.ok) return alert(result.message || '调整失败')
        await reloadWeekly()
      }
    })
    return
  }

  if (state.nav === 'digest') {
    const progress = data.progress || {}
    const candidates = data.candidates || []
    panel.innerHTML = `
      <div class="card">
        <h3>一键生成</h3>
        <p class="muted">从已通过的学习分享和互助广场里，按发帖时间从新到旧取帖，直接生成可复制的推文。一次最多 10 条。</p>
        <div class="actions">
          <button type="button" data-by-time="latest5">最近 5 条</button>
          <button type="button" data-by-time="latest">最近 10 条</button>
          <button type="button" class="quiet" data-by-time="24h">最近 24 小时</button>
          <button type="button" class="quiet" data-by-time="7d">最近 7 天</button>
        </div>
      </div>
      <div class="card">
        <div class="row">
          <div>
            <h3>自己挑帖子</h3>
            <p class="muted">勾选要放进推文的帖子，最多 10 条，按时间从新到旧排列。没通过审核的帖不会出现在这里。</p>
          </div>
        </div>
        ${candidates.length ? `
          <div class="pick-bar">
            <span id="pick-count" class="pick-count"></span>
            <button type="button" class="quiet" data-pick-top="5">选最新 5 条</button>
            <button type="button" class="quiet" data-pick-top="10">选最新 10 条</button>
            <button type="button" class="quiet" data-pick-top="0">全不选</button>
          </div>
          <div class="pick-list">
            ${candidates.map((item) => `
              <label class="pick-row">
                <input type="checkbox" data-pick="1" data-type="${esc(item.contentType)}" data-id="${esc(item.contentId)}" data-title="${esc(item.title)}" />
                <span class="pick-no"></span>
                <span class="pick-main">
                  <span class="pick-line">
                    <span class="pick-topic">${esc(item.topic || '')}</span>
                    <strong class="pick-title">${esc(item.title)}</strong>
                  </span>
                  ${item.excerpt && item.excerpt !== item.title ? `<span class="pick-excerpt">${esc(item.excerpt)}</span>` : ''}
                </span>
                <span class="pick-meta">
                  <span>${esc(item.authorName || '')}</span>
                  <span>${formatTime(item.createdAt)}</span>
                  <span>赞 ${item.likeCount || 0} · 评 ${item.commentCount || 0}${item.imageCount ? ` · ${item.imageCount} 图` : ''}</span>
                </span>
              </label>`).join('')}
          </div>
          <div class="pick-dock">
            <div class="pick-dock-info">
              <span id="pick-dock-count" class="pick-count"></span>
              <span id="pick-order" class="pick-order"></span>
            </div>
            <button id="custom-digest" type="button">用勾选的生成推文</button>
          </div>` : '<p class="muted">还没有已通过的帖子。</p>'}
      </div>
      <div class="card">
        <div class="row">
          <div>
            <h3>审核队列 ${progress.count || 0}</h3>
            <p class="muted">互助广场通过审核后会进这个队列，仅供查看。不会再满 10 条就自动出文。</p>
          </div>
          <button id="flush-btn" type="button">用队列生成</button>
        </div>
      </div>
      ${listOrEmpty(progress.queued, (item, index) => `
        <div class="card list-item">
          <strong>${index + 1}. ${esc(item.title)}</strong>
          <div class="meta">${esc(item.channel)} · ${esc(item.summary)}</div>
        </div>`)}
      <h3>已生成的推文</h3>
      ${listOrEmpty(data.digests, (item) => `
        <div class="card list-item">
          <div class="row">
            <strong>${esc(item.title)}</strong>
            <span>${formatTime(item.createdAt)} · ${(item.items || []).length} 条</span>
          </div>
          <textarea data-paste="${esc(item.id)}" readonly style="width:100%;min-height:180px;margin-top:12px;box-sizing:border-box">${esc(item.pasteText || '还没有文字链。点下面的按钮生成。')}</textarea>
          <div class="actions">
            <button type="button" data-copy="${esc(item.id)}">复制推文</button>
            <button type="button" data-repaste="${esc(item.id)}">重新生成文字链</button>
          </div>
        </div>`)}`
    panel.querySelectorAll('[data-by-time]').forEach((btn) => {
      btn.onclick = async () => {
        btn.disabled = true
        try {
          const result = await api('/api/digest/by-time', {
            method: 'POST',
            body: JSON.stringify({ range: btn.dataset.byTime })
          })
          alert(result.ok ? (result.message || '推文已生成') : (result.message || '失败'))
          await refreshDigest()
        } catch (err) {
          alert((err && err.message) || '按时间出成稿失败')
        } finally {
          btn.disabled = false
        }
      }
    })
    // 勾选计数：行首编号就是生成后的顺序，满 10 条后其余框禁用
    const pickBoxes = Array.from(panel.querySelectorAll('[data-pick]'))
    const syncPicks = () => {
      const picked = pickBoxes.filter((box) => box.checked)
      const countText = `已选 ${picked.length} / 10`
      ;['#pick-count', '#pick-dock-count'].forEach((sel) => {
        const el = panel.querySelector(sel)
        if (el) el.textContent = countText
      })
      const orderEl = panel.querySelector('#pick-order')
      if (orderEl) orderEl.textContent = picked.map((box, index) => `${index + 1}. ${box.dataset.title}`).join('　')
      pickBoxes.forEach((box) => {
        const row = box.closest('.pick-row')
        row.classList.toggle('picked', box.checked)
        row.querySelector('.pick-no').textContent = box.checked ? String(picked.indexOf(box) + 1) : ''
        box.disabled = !box.checked && picked.length >= 10
      })
      const btn = panel.querySelector('#custom-digest')
      if (btn) btn.disabled = !picked.length
    }
    pickBoxes.forEach((box, index) => {
      box.checked = index < 10
      box.onchange = syncPicks
    })
    panel.querySelectorAll('[data-pick-top]').forEach((btn) => {
      btn.onclick = () => {
        const top = Number(btn.dataset.pickTop) || 0
        pickBoxes.forEach((box, index) => { box.checked = index < top })
        syncPicks()
      }
    })
    syncPicks()
    const customBtn = panel.querySelector('#custom-digest')
    if (customBtn) {
      customBtn.onclick = async () => {
        const items = pickBoxes.filter((box) => box.checked).map((box) => ({ contentType: box.dataset.type, contentId: box.dataset.id }))
        if (!items.length) return alert('先勾选要放进推文的帖子')
        if (items.length > 10) return alert('一次最多 10 条')
        customBtn.disabled = true
        try {
          const result = await api('/api/digest/custom', {
            method: 'POST',
            body: JSON.stringify({ items })
          })
          alert(result.ok ? (result.message || '推文已生成') : (result.message || '失败'))
          await refreshDigest()
        } catch (err) {
          alert((err && err.message) || '生成推文失败')
        } finally {
          customBtn.disabled = false
        }
      }
    }
    panel.querySelector('#flush-btn').onclick = async () => {
      const btn = panel.querySelector('#flush-btn')
      if (btn) btn.disabled = true
      try {
        const result = await api('/api/digest/flush', { method: 'POST', body: '{}' })
        alert(result.ok ? (result.message || '汇总已生成') : (result.message || '失败'))
        await refreshDigest()
      } catch (err) {
        alert((err && err.message) || '用队列生成失败')
      } finally {
        if (btn) btn.disabled = false
      }
    }
    panel.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.onclick = () => {
        const box = panel.querySelector(`[data-paste="${btn.dataset.copy}"]`)
        const text = (box && box.value) || ''
        if (!text) return alert('还没有可复制的文案')
        box.focus()
        box.select()
        box.setSelectionRange(0, text.length)
        let ok = false
        try { ok = document.execCommand('copy') } catch (err) { ok = false }
        if (ok) {
          btn.textContent = '已复制'
          return
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => {
            btn.textContent = '已复制'
          }).catch(() => {
            btn.textContent = '请按 Command+C'
          })
          return
        }
        btn.textContent = '请按 Command+C'
      }
    })
    panel.querySelectorAll('[data-repaste]').forEach((btn) => {
      btn.onclick = async () => {
        btn.disabled = true
        const result = await api('/api/digest/paste', { method: 'POST', body: JSON.stringify({ id: btn.dataset.repaste }) })
        if (!result.ok) {
          btn.disabled = false
          return alert(result.message || '生成失败')
        }
        await refreshDigest()
      }
    })
    return
  }
  if (state.nav === 'groups') {
    const wecom = data.wecom || {}
    panel.innerHTML = `
      <div class="card">
        <h3>企微自动群发</h3>
        <p class="muted">开发者可以不在这家公司。公司里的人把企业ID、Secret、群主账号发给开发者，填进 server/.env 和云函数环境变量。</p>
        <p class="muted">${wecom.ready ? `已配置，群主账号：${esc(wecom.sender)}` : `还没配齐：${esc((wecom.missing || []).join('、') || '企业ID、Secret、群主账号')}`}</p>
        <button id="sync-group" type="button">拉取并绑定「群聊推送测试」</button>
      </div>
      <div class="card">
        <h3>添加客户群</h3>
        <label class="field-label">群名称</label><input id="g-name" />
        <label class="field-label">chatId</label><input id="g-chat" />
        <label class="field-label">发送成员（可选）</label><input id="g-sender" />
        <button id="add-group" type="button" style="margin-top:16px">保存并指定</button>
      </div>
      ${listOrEmpty(data.groups, (item) => `
        <div class="card list-item">
          <div class="row"><strong>${esc(item.name)}</strong><span>${item.enabled ? '启用' : '停用'} · ${item.receiveDigest ? '接收汇总' : '不接收'}</span></div>
          <div class="meta">${item.chatId ? `chatId：${esc(item.chatId)}` : '未填 chatId，还不能自动群发'}</div>
          <div class="actions">
            <button data-toggle="enabled" data-id="${esc(item.id)}">启停</button>
            <button data-toggle="receiveDigest" data-id="${esc(item.id)}">是否接收汇总</button>
          </div>
          <label class="field-label">更新 chatId</label>
          <div class="row">
            <input data-edit="${esc(item.id)}" value="${esc(item.chatId || '')}" />
            <button data-save="${esc(item.id)}" type="button">保存</button>
          </div>
        </div>`)}`
    panel.querySelector('#sync-group').onclick = async () => {
      const result = await api('/api/wecom/sync', { method: 'POST', body: '{}' })
      alert(result.ok ? `已绑定：${result.group && result.group.name}（${result.group && result.group.chatId}）` : (result.message || '失败'))
      await reload()
    }
    panel.querySelector('#add-group').onclick = async () => {
      const result = await api('/api/groups', {
        method: 'POST',
        body: JSON.stringify({
          name: panel.querySelector('#g-name').value,
          chatId: panel.querySelector('#g-chat').value,
          sender: panel.querySelector('#g-sender').value,
          receiveDigest: true
        })
      })
      if (!result.ok) return alert(result.message)
      await reload()
    }
    panel.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.onclick = async () => {
        await api('/api/groups/toggle', { method: 'POST', body: JSON.stringify({ id: btn.dataset.id, field: btn.dataset.toggle }) })
        await reload()
      }
    })
    panel.querySelectorAll('[data-save]').forEach((btn) => {
      btn.onclick = async () => {
        const input = panel.querySelector(`[data-edit="${btn.dataset.save}"]`)
        const result = await api('/api/groups', { method: 'PUT', body: JSON.stringify({ id: btn.dataset.save, chatId: input.value }) })
        if (!result.ok) return alert(result.message)
        await reload()
      }
    })
    return
  }
  if (state.nav === 'school') {
    panel.innerHTML = `
      <div class="card">
        <h3>给账号改学校</h3>
        <p class="muted">学校认证完成后，用户自己不能再改。把小程序「我的」里的账号编号贴过来，填写学校全称。校区可以空着。这个人如果开了学校标签，已发帖上的学校会一起换掉。</p>
        <label class="field-label">账号编号</label>
        <input id="school-user" placeholder="u_ 开头" />
        <label class="field-label">学校全称</label>
        <input id="school-name" placeholder="例如 武汉大学" />
        <label class="field-label">校区</label>
        <input id="school-campus" placeholder="可空" />
        <button id="school-set" type="button" style="margin-top:16px">保存学校</button>
      </div>
      <div class="chips">
        ${['pending', '全部', 'approved', 'rejected'].map((id) => `<button class="chip ${state.schoolStatus === id ? 'active' : ''}" data-status="${id}">${id === 'pending' ? '待审核' : id === '全部' ? '全部' : id === 'approved' ? '已通过' : '已驳回'}</button>`).join('')}
      </div>
      ${listOrEmpty(data.schoolList, (item) => `
        <div class="card list-item">
          <div class="row"><strong>${esc(item.userNickname)}</strong><span>${esc(item.status)}</span></div>
          <div>${esc(item.oldSchoolName)} → ${esc(item.newSchoolName)}</div>
          <div class="meta">${esc(item.reason)} · ${formatTime(item.createdAt)}</div>
          ${item.status === 'pending' ? `<div class="actions">
            <button data-review="1" data-id="${esc(item.id)}">通过</button>
            <button data-review="0" data-id="${esc(item.id)}">驳回</button>
          </div>` : ''}
        </div>`)}`
    const schoolSet = panel.querySelector('#school-set')
    if (schoolSet) {
      schoolSet.onclick = async () => {
        const result = await api('/api/school/set', {
          method: 'POST',
          body: JSON.stringify({
            id: panel.querySelector('#school-user').value.trim(),
            schoolName: panel.querySelector('#school-name').value.trim(),
            schoolCampus: panel.querySelector('#school-campus').value.trim()
          })
        })
        alert(result.ok ? (result.message || '已更新') : (result.message || '失败'))
      }
    }
    panel.querySelectorAll('[data-status]').forEach((btn) => {
      btn.onclick = async () => {
        state.schoolStatus = btn.dataset.status
        const result = await api(`/api/school?status=${encodeURIComponent(state.schoolStatus)}`)
        state.data.schoolList = result.list || []
        render()
      }
    })
    panel.querySelectorAll('[data-review]').forEach((btn) => {
      btn.onclick = async () => {
        const note = window.prompt('审核备注（可选）', '') || ''
        const result = await api('/api/school/review', { method: 'POST', body: JSON.stringify({ id: btn.dataset.id, approved: btn.dataset.review === '1', note }) })
        if (!result.ok) return alert(result.message)
        await reload()
      }
    })
    return
  }
  if (state.nav === 'student') {
    const list = data.studentAuthList || []
    panel.innerHTML = `
      <div class="card">
        <p class="muted">证明照片为选填。没有照片时按学校信息与补充说明人工核对，仍可通过或驳回。材料仅供核验，勿外传。</p>
      </div>
      <div class="chips">
        ${['pending', '全部', 'approved', 'rejected'].map((id) => `<button class="chip ${state.studentStatus === id ? 'active' : ''}" data-status="${id}">${id === 'pending' ? '待审核' : id === '全部' ? '全部' : id === 'approved' ? '已通过' : '已驳回'}</button>`).join('')}
      </div>
      ${listOrEmpty(list, (item) => `
        <div class="card list-item">
          <div class="row"><strong>${esc(item.userNickname)}</strong><span>${esc(item.status)}</span></div>
          <div>${esc(item.schoolName)}${item.schoolCampus ? ` · ${esc(item.schoolCampus)}` : ''}</div>
          <div class="meta">${esc(item.note || '无补充说明')} · ${formatTime(item.createdAt)}</div>
          <div class="meta">${(item.images || []).length} 张材料</div>
          ${(item.images || []).map((url) => `<a class="thumb" href="${esc(url)}" target="_blank" rel="noreferrer"><img src="${esc(url)}" alt="" /></a>`).join('')}
          ${item.status === 'pending' ? `<div class="actions">
            <button data-sreview="1" data-id="${esc(item.id)}">通过</button>
            <button data-sreview="0" data-id="${esc(item.id)}">驳回</button>
          </div>` : `<div class="meta">${esc(item.reviewNote || '')}</div>`}
        </div>`)}`
    panel.querySelectorAll('[data-status]').forEach((btn) => {
      btn.onclick = async () => {
        state.studentStatus = btn.dataset.status
        const result = await api(`/api/student-auth?status=${encodeURIComponent(state.studentStatus)}`)
        state.data.studentAuthList = result.list || []
        render()
      }
    })
    panel.querySelectorAll('[data-sreview]').forEach((btn) => {
      btn.onclick = async () => {
        const note = window.prompt('审核备注（可选）', '') || ''
        const result = await api('/api/student-auth/review', {
          method: 'POST',
          body: JSON.stringify({ id: btn.dataset.id, approved: btn.dataset.sreview === '1', note })
        })
        if (!result.ok) return alert(result.message)
        await reload()
      }
    })
    return
  }
  panel.innerHTML = `
    <div class="card">
      <h3>使用说明</h3>
      <p>审帖、举报、禁言和封号都写回小程序正在用的云数据库。</p>
      <p>帖子被 3 个不同的人举报后会自动隐藏，并出现在「内容审核」的「用户举报」和「帖子与评论」里。</p>
    </div>
    <div class="card">
      <h3>联系反馈</h3>
      <p class="muted">互助广场查看微信号后的对接反馈（靠谱 / 未回复 / 疑似诈骗等）</p>
      ${listOrEmpty(data.contactFeedbacks, (item) => `
        <div class="list-item">
          <div class="row"><strong>${esc(item.reasonLabel || item.reason)}</strong><span>${esc(item.tag || '互助广场')}</span></div>
          <div>${esc(item.postHeadline || item.postId)}</div>
          <div class="meta">${esc(item.viewerName || item.viewerId)} · ${formatTime(item.updatedAt || item.createdAt)}</div>
          ${item.note ? `<div class="meta">${esc(item.note)}</div>` : ''}
        </div>`)}
    </div>
    <div class="card">
      <h3>风控日志</h3>
      ${listOrEmpty(data.securityLogs, (item) => `
        <div class="list-item">
          <div class="row"><strong>${esc(item.userNickname || item.userId)}</strong><span>${esc(item.level)}</span></div>
          <div>${esc(item.detail)}</div>
          <div class="meta">${formatTime(item.createdAt)}</div>
        </div>`)}
    </div>`
}


function statusClass(status) {
  if (status === 'emergency_block') return 'emergency'
  if (status === 'rejected') return 'danger'
  if (status === 'edit_required') return 'warn'
  if (status === 'manual_review' || status === 'pending') return 'info'
  if (status === 'approved') return 'ok'
  return ''
}

function signalLines(signals) {
  return Object.entries(signals || {})
    .filter(([, words]) => words && words.length)
    .map(([key, words]) => `${key}: ${words.join('、')}`)
    .join(' · ') || '—'
}

function renderReviewDetail(el, item) {
  if (!el || !item) return
  const images = Array.isArray(item.images) ? item.images : []
  el.innerHTML = `
    <div class="row">
      <div>
        <div class="status-pill ${statusClass(item.reviewStatus)}">${esc(item.reviewStatusLabel || item.reviewStatus || '')}${item.reviewPriority === 'high' ? ' · 优先' : ''}</div>
        <h3 style="margin-top:12px">${esc(item.headline || item.title || '无标题')}</h3>
      </div>
      <div class="meta">${esc(TYPE_LABEL[item.contentType] || '')} · ${esc(item.channel || '')}</div>
    </div>
    <div class="meta">${formatTime(item.createdAt)} · 作者 ${authorHtml(item.authorName, item.anonymous, item.authorRisk && { id: item.authorRisk.id, nickname: item.authorRisk.nickname })}</div>
    ${item.authorRisk ? `<div class="meta">账号风险 ${item.authorRisk.riskScore || 0} · 违规 ${item.authorRisk.violateCount || 0} · ${esc(item.authorRisk.schoolName || '未认证')}</div>` : ''}
    <div class="detail-block">
      <div class="field-label">正文</div>
      <div class="detail-text">${esc(item.content || '')}</div>
    </div>
    ${item.originalText ? `<div class="detail-block"><div class="field-label">原文快照</div><div class="detail-text mono">${esc(item.originalText)}</div></div>` : ''}
    ${item.normalizedText ? `<div class="detail-block"><div class="field-label">标准化文本</div><div class="detail-text mono">${esc(item.normalizedText)}</div></div>` : ''}
    <div class="detail-block">
      <div class="field-label">命中规则 / 信号</div>
      <div class="meta">规则 ${esc(ruleText(item.reviewRuleIds))}</div>${retiredHint(item.reviewRuleIds)}
      <div class="meta">${esc(signalLines(item.reviewSignals))}</div>
      <div class="meta">${esc(item.reviewNote || '')}</div>
    </div>
    ${item.contactType ? `<div class="detail-block"><div class="field-label">专用联系方式字段</div><div class="meta">${esc(item.contactType)}：${esc(item.contactValue || '（已填写）')}</div></div>` : ''}
    ${images.length ? `<div class="detail-block"><div class="field-label">图片</div><div class="image-row">${images.map((url) => `<a href="${esc(url)}" target="_blank" rel="noreferrer"><img src="${esc(url)}" alt="" /></a>`).join('')}</div></div>` : ''}
    <label class="field-label">审核备注</label>
    <input id="review-note" value="${esc(item.reviewNote || '')}" placeholder="可选，会展示给发布者" />
    <div class="actions" style="margin-top:16px">
      <button data-routcome="approved" class="ok-btn" type="button">通过并公开</button>
      <button data-routcome="edit_required" type="button">要求修改</button>
      <button data-routcome="manual_review" type="button">继续人工</button>
      <button data-routcome="rejected" class="danger-btn" type="button">拒绝</button>
      <button data-routcome="emergency_block" class="danger-btn" type="button">紧急拦截</button>
      ${item.authorRisk && item.authorRisk.id ? '<button data-account="mute" type="button">禁言作者 24h</button><button data-account="ban" class="danger-btn" type="button">封号作者</button>' : ''}
    </div>`
  el.querySelectorAll('[data-routcome]').forEach((btn) => {
    btn.onclick = async () => {
      const note = el.querySelector('#review-note').value
      const result = await api('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({
          type: item.contentType,
          id: item.id,
          outcome: btn.dataset.routcome,
          note
        })
      })
      if (!result.ok) return alert(result.message || '操作失败')
      const done = {
        approved: '已通过，帖子会公开',
        edit_required: '已要求修改，公开列表里不会再显示',
        manual_review: '已转回人工，公开列表里不会再显示',
        rejected: '已拒绝，公开列表里不会再显示',
        emergency_block: '已紧急拦截，公开列表里不会再显示'
      }
      alert(done[btn.dataset.routcome] || '已更新')
      state.selectedReview = null
      await refreshReviews()
    }
  })
  el.querySelectorAll('[data-account]').forEach((btn) => {
    btn.onclick = async () => {
      if (!item.authorRisk || !item.authorRisk.id) return
      const note = window.prompt('处置原因', btn.dataset.account === 'ban' ? '审帖核实后封号' : '审帖核实后禁言') || ''
      const result = await api('/api/accounts/status', {
        method: 'POST',
        body: JSON.stringify({
          id: item.authorRisk.id,
          status: btn.dataset.account === 'ban' ? 'banned' : 'muted',
          reason: note,
          muteHours: 24
        })
      })
      if (!result.ok) return alert(result.message || '处置失败')
      await refreshReviews()
    }
  })
}

async function refreshReviews() {
  const result = await api(`/api/reviews?status=${encodeURIComponent(state.reviewStatus || 'queue')}`)
  if (!result.ok) return
  state.data = state.data || {}
  state.data.reviews = result.list || []
  if (state.nav === 'review') render()
}

function stat(num, label) {
  return `<div class="card stat-card"><div class="stat-num">${num || 0}</div><div class="stat-label">${label}</div></div>`
}

function listOrEmpty(list, renderItem) {
  if (!list || !list.length) return '<div class="empty">暂无数据</div>'
  return list.map(renderItem).join('')
}

function statusText(item) {
  if (item.status === 'banned') return '已封禁'
  if (item.status === 'muted' && item.muteUntil > Date.now()) return '禁言中'
  return '正常'
}

async function refreshDigest() {
  const result = await api('/api/digest')
  if (!result.ok) return
  state.data = state.data || {}
  state.data.progress = result.progress
  state.data.digests = result.digests || []
  // 原版漏存候选帖，导致「自己挑帖子」一直是空的
  state.data.candidates = result.candidates || []
  if (state.nav === 'digest') render()
}

// ---- 我的页封面（meta/mine_cover）----
const COVER_MAX_EDGE = 1600

async function reloadCover() {
  const result = await api('/api/mine-cover')
  if (!result.ok) return
  state.data = state.data || {}
  state.data.cover = result.cover
  state.coverDraft = null
  if (state.nav === 'cover') render()
}

// 手机原图常超过 2MB：浏览器里先缩到长边 1600、转 JPEG 再上传
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('图片格式无法识别'))
      img.onload = () => {
        const scale = Math.min(1, COVER_MAX_EDGE / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.86))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

function renderCover(panel, saved) {
  const local = (state.data && state.data.overview && state.data.overview.mode) !== 'cloud'
  const draft = state.coverDraft || {
    src: (saved && saved.src) || '',
    previewUrl: (saved && saved.previewUrl) || '',
    credit: saved ? saved.credit : '',
    enabled: saved ? saved.enabled : true
  }
  state.coverDraft = draft
  panel.innerHTML = `
    <div class="card cover-card">
      <h3>我的页封面</h3>
      <p class="muted">小程序「我的」页和个人主页顶部的照片。保存后最多 5 分钟生效；不设置或停用时，小程序用包内默认图（摄影：j07）。</p>
      <div class="cover-layout">
        <div class="cover-preview">
          ${draft.previewUrl
            ? `<img src="${esc(draft.previewUrl)}" alt="封面预览" />`
            : '<div class="cover-empty">还没有设置，小程序正在用默认图</div>'}
          ${draft.previewUrl && draft.credit ? `<span class="cover-credit">${esc(draft.credit)}</span>` : ''}
        </div>
        <div class="cover-form">
          <label>图片</label>
          <div class="row gap">
            <label class="upload-btn">上传图片<input id="cover-file" type="file" accept="image/jpeg,image/png,image/webp" hidden /></label>
            <span id="cover-upload-status" class="muted"></span>
          </div>
          <input id="cover-src" placeholder="或填写 cloud:// 文件 ID / https 链接" value="${esc(draft.src)}" />
          <label>署名</label>
          <input id="cover-credit" maxlength="30" placeholder="例如：摄影：j07" value="${esc(draft.credit || '')}" />
          <label class="check-row"><input id="cover-enabled" type="checkbox" ${draft.enabled !== false ? 'checked' : ''}/><span>在小程序里使用这张图</span></label>
          <div class="row gap cover-actions">
            <button id="cover-save" type="button">保存</button>
            ${saved && saved.updatedAt ? `<span class="muted">上次保存：${esc(formatTime(saved.updatedAt))}${saved.updatedBy ? ' · ' + esc(saved.updatedBy) : ''}</span>` : ''}
          </div>
          <p class="muted cover-tip">建议横图，约 1125×960，画面主体放在中上部（底部约 20% 会渐隐）。大图会自动压缩。${local ? '<br/>当前是本地演示模式：上传的图只用于后台预览，小程序读不到。' : ''}</p>
        </div>
      </div>
    </div>`

  const status = panel.querySelector('#cover-upload-status')
  panel.querySelector('#cover-file').onchange = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    status.textContent = '上传中…'
    try {
      const dataUrl = await shrinkImage(file)
      const result = await api('/api/mine-cover/upload', {
        method: 'POST',
        body: JSON.stringify({ type: 'image/jpeg', data: dataUrl })
      })
      if (!result.ok) {
        status.textContent = result.message || '上传失败'
        return
      }
      state.coverDraft = { ...readCoverForm(panel), src: result.src, previewUrl: result.previewUrl }
      render()
    } catch (err) {
      status.textContent = (err && err.message) || '上传失败'
    }
  }
  panel.querySelector('#cover-credit').oninput = () => {
    state.coverDraft = { ...state.coverDraft, ...readCoverForm(panel) }
    const tag = panel.querySelector('.cover-credit')
    if (tag) tag.textContent = state.coverDraft.credit
  }
  panel.querySelector('#cover-save').onclick = async () => {
    const form = readCoverForm(panel)
    const result = await api('/api/mine-cover', { method: 'POST', body: JSON.stringify(form) })
    if (!result.ok) return alert(result.message || '保存失败')
    state.data.cover = result.cover
    state.coverDraft = null
    render()
  }
}

function readCoverForm(panel) {
  const src = panel.querySelector('#cover-src').value.trim()
  const draft = state.coverDraft || {}
  return {
    src,
    previewUrl: src === draft.src ? draft.previewUrl : (/^https:\/\//.test(src) ? src : ''),
    credit: panel.querySelector('#cover-credit').value.trim(),
    enabled: panel.querySelector('#cover-enabled').checked
  }
}

async function reloadWeekly() {
  const result = await api(`/api/weekly-hot?keyword=${encodeURIComponent(state.weeklyKeyword || '')}`)
  if (!result.ok) return
  state.data = state.data || {}
  state.data.weeklyHot = {
    board: result.board,
    candidates: result.candidates,
    max: result.max
  }
  render()
}

async function loadNav(nav) {
  state.data = state.data || {}
  if (nav === 'overview') {
    const result = await api('/api/dashboard')
    if (!result.ok) return
    state.data.overview = result.data.overview
    state.data.reviews = (result.data.reviews || []).slice(0, 5)
    if (state.nav === 'overview') render()
    return
  }
  if (nav === 'weekly') return reloadWeekly()
  if (nav === 'cover') return reloadCover()
  if (nav === 'digest') return refreshDigest()
  if (nav === 'reports') {
    const result = await api('/api/reports?status=' + encodeURIComponent('全部'))
    if (!result.ok) return
    state.data.reports = result.list || []
    if (state.nav === 'reports') render()
    return
  }
  if (nav === 'review') return refreshReviews()
  if (nav === 'keywords') {
    const [lex, words] = await Promise.all([api('/api/lexicons'), api('/api/keywords')])
    if (lex.ok) state.data.lexicons = { rows: lex.rows, types: lex.types, meta: lex.meta }
    if (words.ok) state.data.keywords = words.list || []
    if (state.nav === 'keywords') render()
    return
  }
  if (nav === 'staff') {
    const result = await api('/api/staff')
    if (!result.ok) return
    state.role = result.role || state.role
    state.staffAccount = result.account || state.staffAccount
    state.data.staff = result.list || []
    if (state.nav === 'staff') render()
    return
  }
  if (nav === 'whitelist') {
    const result = await api('/api/whitelist')
    if (!result.ok) return
    state.data.whitelist = result.list || []
    if (state.whitelistQuery) {
      const found = await api('/api/accounts/search?q=' + encodeURIComponent(state.whitelistQuery))
      if (found.ok) state.data.whitelistHits = found.list || []
    }
    if (state.nav === 'whitelist') render()
    return
  }
  if (nav === 'official') {
    const result = await api('/api/official-login')
    if (!result.ok) return
    state.data.official = result.list || []
    if (state.officialQuery) {
      const found = await api('/api/accounts/search?q=' + encodeURIComponent(state.officialQuery))
      if (found.ok) state.data.officialHits = found.list || []
    }
    if (state.nav === 'official') render()
    return
  }
  if (nav === 'accounts') {
    const accounts = await api('/api/accounts')
    if (accounts.ok) state.data.accounts = accounts.list || []
    if (state.nav === 'accounts') render()
    // 拦截列表后置，避免和账号列表抢跨海连接
    const intercepts = await api('/api/reviews?status=' + encodeURIComponent('rejected'))
    if (intercepts.ok) state.data.intercepts = intercepts.list || []
    if (state.nav === 'accounts') render()
    return
  }
  if (nav === 'groups') {
    const result = await api('/api/groups')
    if (!result.ok) return
    state.data.groups = result.groups || []
    state.data.wecom = result.wecom || {}
    if (state.nav === 'groups') render()
    return
  }
  if (nav === 'more') {
    const result = await api('/api/more')
    if (!result.ok) return
    state.data.securityLogs = result.securityLogs || []
    state.data.contactFeedbacks = result.contactFeedbacks || []
    if (state.nav === 'more') render()
    return
  }
  if (nav === 'school' || nav === 'student') {
    const path = nav === 'school' ? '/api/school' : '/api/student-auth'
    const status = nav === 'school' ? state.schoolStatus : state.studentStatus
    const result = await api(`${path}?status=${encodeURIComponent(status || 'pending')}`)
    if (!result.ok) return
    if (nav === 'school') state.data.schoolList = result.list || []
    else state.data.studentAuthList = result.list || []
    if (state.nav === nav) render()
  }
}

async function reload() {
  await loadNav(state.nav)
}

async function doLogin() {
  const result = await api('/api/login', {
    method: 'POST',
    body: JSON.stringify({
      account: document.getElementById('account').value,
      password: document.getElementById('password').value
    })
  })
  document.getElementById('login-error').textContent = result.ok ? '' : (result.message || '登录失败')
  if (!result.ok) return
  document.getElementById('account-name').textContent = result.name || result.account
  state.role = result.role || 'root'
  state.staffAccount = result.account || ''
  showApp()
  await reload()
}

document.getElementById('login-btn').onclick = doLogin
document.getElementById('password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doLogin()
})

document.getElementById('logout-btn').onclick = async () => {
  await api('/api/logout', { method: 'POST', body: '{}' })
  showLogin()
}

document.querySelectorAll('aside nav button').forEach((btn) => {
  btn.onclick = async () => {
    state.nav = btn.dataset.nav
    render()
    await loadNav(state.nav)
  }
})

api('/api/session').then(async (result) => {
  if (!result.ok) return showLogin()
  document.getElementById('account-name').textContent = result.name || result.account || ''
  state.role = result.role || 'root'
  state.staffAccount = result.account || ''
  showApp()
  await reload()
})
