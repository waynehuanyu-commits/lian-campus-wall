const state = {
  nav: 'overview',
  data: null,
  schoolStatus: 'pending',
  studentStatus: 'pending',
  reviewStatus: 'queue',
  lexiconSignal: 'academic_core',
  weeklyKeyword: '',
  coverDraft: null,
  guideStatus: 'pending',
  guideView: 'list',
  guideDraft: null,
  guidePickKeyword: '',
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
  content: ['', '内容审核'],
  modlogs: ['', '内容审核'],
  keywords: ['', '风控词库'],
  accounts: ['', '用户管理'],
  whitelist: ['', '用户管理'],
  official: ['', '用户管理'],
  staff: ['', '后台成员'],
  digest: ['', '手动生成文字链'],
  weekly: ['', '园区热议'],
  cover: ['', '我的页封面'],
  guides: ['', '黎安攻略'],
  groups: ['', '企微群发'],
  school: ['', '学校修改审核'],
  student: ['', '学生认证审核'],
  more: ['', '风控日志与反馈']
}

// 合并后的菜单：侧栏只显示第一项，页内用子标签切换；各子页面的数据和接口保持原样
const NAV_GROUPS = {
  review: [
    { nav: 'review', label: '待审队列' },
    { nav: 'reports', label: '用户举报' },
    { nav: 'content', label: '内容管理' },
    { nav: 'modlogs', label: '处置记录' }
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

// forum / wall 是数据库里两张帖子表（forum_posts / wall_posts）的历史分法，产品上早已合成一个首页、一个发帖入口。
// 对外和后台界面一律只显示「帖子」+ 话题，不再出现「学习分享 / 互助广场」；contentType 的取值本身不能改，接口和老数据都靠它。
const TYPE_LABEL = {
  forum: '帖子',
  wall: '帖子',
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

// 分身内容在后台标出来，并给出分身昵称和真实账号（昵称 + u_ 编号）
function authorHtml(name, anonymous, real) {
  if (!anonymous) return esc(name || '—')
  const who = real && real.id
    ? `真实账号 ${esc(real.nickname || '未设昵称')}（${esc(real.id)}）`
    : '真实账号未知'
  return `<span class="anon-tag">分身</span> ${esc(name || '')} · ${who}`
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
        ${stat(`${ov.digestCount || 0}`, '企微待推')}
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
            <p class="muted">帖子 ${(ov.forumCount || 0) + (ov.wallCount || 0)} · 评论 ${ov.commentCount || 0}</p>
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
                <strong>${item.anonymous ? '<span class="anon-tag">分身</span> ' : ''}${esc(item.headline || '')}</strong>
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
        <p class="muted">运营要共用一个微信号登录小程序、把朋友圈内容批量发到小程序。先让这个微信号登录一次小程序，打开「我的」复制账号编号，再到左侧「用户管理 › 发帖白名单」里贴上编号，点加入。白名单号不受 10 分钟 5 条、每天 15 条的发帖限制，也不会因为短时间重复内容被拦住。内容审核仍然会走。</p>
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
    renderReports(panel, data.reports)
    return
  }

  if (state.nav === 'content') {
    renderContent(panel, data.content)
    return
  }

  if (state.nav === 'modlogs') {
    renderModLogs(panel, data.modlogs)
    return
  }

  if (state.nav === 'cover') {
    renderCover(panel, data.cover)
    return
  }

  if (state.nav === 'guides') {
    renderGuides(panel, data.guides)
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
              <span class="meta">${esc(item.tag || '帖子')}</span>
            </div>
            <div class="hot-ops">
              <button class="quiet" data-weekly-move="up" data-id="${esc(item.contentId)}" data-type="${esc(item.contentType || 'wall')}" type="button">上移</button>
              <button class="quiet" data-weekly-move="down" data-id="${esc(item.contentId)}" data-type="${esc(item.contentType || 'wall')}" type="button">下移</button>
              <button class="quiet warn" data-weekly-remove="${esc(item.contentId)}" data-type="${esc(item.contentType || 'wall')}" type="button">移除</button>
            </div>
          </div>`)}
      </div>
      <div class="card">
        <h3>添加帖子</h3>
        <div class="row gap">
          <input id="weekly-keyword" placeholder="搜索标题/正文" value="${esc(state.weeklyKeyword)}" />
          <button id="weekly-search" type="button">搜索</button>
        </div>
        ${listOrEmpty(weekly.candidates, (item) => `
          <div class="hot-row">
            <div class="hot-copy">
              <strong>${esc(item.title)}</strong>
              <span class="meta">${esc(item.tag || '帖子')}</span>
              <span class="meta hot-stats">${weeklyStats(item)}</span>
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
        <p class="muted">从已通过的帖子里，按发帖时间从新到旧取帖，直接生成可复制的文字链。一次最多 10 条。</p>
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
            <p class="muted">勾选要放进文字链的帖子，最多 10 条，按时间从新到旧排列。没通过审核的帖不会出现在这里。</p>
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
            <button id="custom-digest" type="button">用勾选的生成文字链</button>
          </div>` : '<p class="muted">还没有已通过的帖子。</p>'}
      </div>
      <div class="card">
        <div class="row">
          <div>
            <h3>审核队列 ${progress.count || 0}</h3>
            <p class="muted">新帖审核通过后自动进这个队列，由服务器按时段自动推到企微群（规则见「企微群发」页，群主要在企业微信里点「发送」）。点「用队列生成」会把队列里的帖子拿去手动生成文字链，这几条就不再推企微。</p>
          </div>
          <button id="flush-btn" type="button">用队列生成</button>
        </div>
      </div>
      ${listOrEmpty(progress.queued, (item, index) => `
        <div class="card list-item">
          <strong>${index + 1}. ${esc(item.title)}</strong>
          <div class="meta">${esc(item.channel)} · ${esc(item.summary)}</div>
        </div>`)}
      <h3>已生成的文字链</h3>
      ${listOrEmpty(data.digests, (item) => `
        <div class="card list-item">
          <div class="row">
            <strong>${esc(item.title)}</strong>
            <span>${formatTime(item.createdAt)} · ${(item.items || []).length} 条</span>
          </div>
          <textarea data-paste="${esc(item.id)}" readonly style="width:100%;min-height:180px;margin-top:12px;box-sizing:border-box">${esc(item.pasteText || '还没有文字链。点下面的按钮生成。')}</textarea>
          <div class="actions">
            <button type="button" data-copy="${esc(item.id)}">复制文字链</button>
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
          alert(result.ok ? (result.message || '文字链已生成') : (result.message || '失败'))
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
    // 推送目标群：从企微拉客户群一键加入。加新群不用改代码、不用重新提审小程序（见 admin/lib/wecom-auto.js）
    const wecom = data.wecom || {}
    const targets = data.groups || []
    const pulled = data.wecomGroups
    const inTargets = new Set(targets.map((item) => item.chatId).filter(Boolean))
    const pushOn = (item) => item.enabled !== false && item.receiveDigest && item.chatId
    const ps = data.pushStatus
    const fmt = (t) => (t ? formatTime(t) : '—')
    const LOG_LABEL = { confirm: '已建群发，等群主点发送', failed: '失败', skipped_risk: '风险内容，未推送' }
    let statusLine = '推送进程没有运行（服务器上的推送开关没开），请联系技术排查'
    let statusClass = 'danger'
    if (ps && ps.running) {
      if (!ps.online) { statusLine = '推送进程失联：超过 5 分钟没有检查队列'; statusClass = 'danger' }
      else if (!ps.enabled) { statusLine = '已暂停：不会自动推送，帖子照常排队'; statusClass = 'warn' }
      else if (ps.pausedUntil) { statusLine = `上次推送失败，${fmt(ps.pausedUntil)} 自动重试`; statusClass = 'warn' }
      else if (ps.quiet) { statusLine = '在线 · 夜间不推送（00:40–08:00），早上 8 点推出夜里攒的帖子'; statusClass = 'ok' }
      else { statusLine = '在线 · 正常运行'; statusClass = 'ok' }
    }
    const statusCard = ps === null ? '<div class="card"><h3>推送状态</h3><p class="muted">状态读取失败，点刷新再试。</p><button id="push-refresh" type="button">刷新</button></div>' : `
      <div class="card">
        <div class="row"><h3>推送状态</h3><span class="push-dot ${statusClass}">${statusClass === 'ok' ? '在线' : (statusClass === 'warn' ? '暂停' : '离线')}</span></div>
        <p class="muted">${esc(statusLine)}</p>
        <div class="push-grid">
          <div><span class="muted">上次检查</span><strong>${fmt(ps.lastTickAt)}</strong></div>
          <div><span class="muted">上次推送</span><strong>${fmt(ps.lastPushAt)}</strong></div>
          <div><span class="muted">下个固定时段</span><strong>${fmt(ps.nextSlotAt)}</strong></div>
          <div><span class="muted">排队中</span><strong>${ps.queue.total} 条${ps.queue.urgent ? ` · 急事 ${ps.queue.urgent}` : ''}${ps.queue.pendingConfirm ? ` · 待确认 ${ps.queue.pendingConfirm}` : ''}</strong></div>
        </div>
        <div class="actions">
          <button id="push-toggle" type="button">${ps.enabled ? '暂停自动推送' : '恢复自动推送'}</button>
          <button id="push-now" type="button">立即推送一次</button>
          <button id="push-refresh" type="button">刷新</button>
        </div>
        ${ps.logs.length ? `<div class="push-logs">${ps.logs.map((log) => `
          <div class="row"><span>${esc(fmt(log.at))} · ${esc(LOG_LABEL[log.status] || log.status)}${log.count ? ` · ${log.count} 帖` : ''}</span><span class="muted">${esc(log.status === 'skipped_risk' ? (log.reasons || []).join('、') : (log.error || ''))}</span></div>`).join('')}</div>` : '<p class="muted">还没有推送记录。</p>'}
      </div>`
    panel.innerHTML = statusCard + `
      <div class="card">
        <h3>企微自动推送</h3>
        <p class="muted">${wecom.ready ? '企微已接通。' : `企微还没配齐：${esc((wecom.missing || []).join('、'))}。`}每天 08:00–00:30 推送：固定时段 08:00 / 12:10 / 13:50 / 17:20 / 20:00 / 22:30 / 00:30；攒满 8 条提前推；急事 10 分钟内插队。每次推送都要群主在自己的企业微信里点「发送」。</p>
      </div>
      <div class="card">
        <div class="row"><h3>正在推送的群</h3><span>${targets.filter(pushOn).length} 个</span></div>
        ${targets.length ? targets.map((item) => `
          <div class="list-item" style="padding:12px 0;border-top:1px solid var(--line, #eee)">
            <div class="row"><strong>${esc(item.name)}</strong><span>${pushOn(item) ? '推送中' : (item.chatId ? '已停推' : '缺 chatId，推不了')}</span></div>
            <div class="meta">群主：${esc(item.ownerName || item.sender || '—')}</div>
            <div class="actions">
              ${item.chatId ? `<button data-toggle="enabled" data-id="${esc(item.id)}">${pushOn(item) ? '停推' : '恢复推送'}</button>` : ''}
              <button data-remove="${esc(item.id)}" data-name="${esc(item.name)}">移出名单</button>
            </div>
          </div>`).join('') : '<p class="muted">还没有推送的群。点下面「拉取企微客户群」，在要推送的群后面点「加入推送」。</p>'}
      </div>
      <div class="card">
        <div class="row"><h3>企微里的客户群</h3><button id="pull-groups" type="button">${pulled ? '重新拉取' : '拉取企微客户群'}</button></div>
        <p class="muted">只列开通了「客户联系」的同事做群主的外部客户群。新建群后点重新拉取即可。</p>
        ${pulled ? (pulled.length ? pulled.map((g) => `
          <div class="row" style="padding:10px 0;border-top:1px solid var(--line, #eee)">
            <div><strong>${esc(g.name)}</strong><div class="meta">群主 ${esc(g.ownerName || g.owner)} · ${g.memberCount || 0} 人</div></div>
            ${inTargets.has(g.chatId) ? '<span class="muted">已在名单</span>' : `<button data-add="${esc(g.chatId)}" data-name="${esc(g.name)}" data-owner="${esc(g.owner)}" data-owner-name="${esc(g.ownerName || '')}">加入推送</button>`}
          </div>`).join('') : '<p class="muted">企微里没有找到客户群。</p>') : ''}
      </div>`
    const refreshBtn = panel.querySelector('#push-refresh')
    if (refreshBtn) refreshBtn.onclick = () => reload()
    const toggleBtn = panel.querySelector('#push-toggle')
    if (toggleBtn) toggleBtn.onclick = async () => {
      const next = !(ps && ps.enabled)
      if (!next && !confirm('暂停后不会自动推送到企微群，帖子照常排队，恢复后会补推。确定暂停？')) return
      const result = await api('/api/wecom/push-toggle', { method: 'POST', body: JSON.stringify({ enabled: next }) })
      if (!result.ok) return alert(result.message || '操作失败')
      await reload()
    }
    const nowBtn = panel.querySelector('#push-now')
    if (nowBtn) nowBtn.onclick = async () => {
      if (!confirm('现在就把队列里可推的帖子推到企微群？群主需要在企业微信里点「发送」。')) return
      nowBtn.disabled = true
      nowBtn.textContent = '推送中…'
      const result = await api('/api/wecom/push-now', { method: 'POST', body: '{}' })
      const r = result.result || {}
      const msg = r.ok ? `已建 ${(r.results || []).length} 条群发，去企业微信点「发送」` : (r.error ? `失败：${r.error}` : (r.queued === 0 ? '队列是空的，没有可推的帖子' : '没有可推的帖子（可能都在等确认）'))
      alert(msg)
      await reload()
    }
    panel.querySelector('#pull-groups').onclick = async (event) => {
      event.target.disabled = true
      event.target.textContent = '拉取中…'
      const result = await api('/api/wecom/groups')
      if (!result.ok) {
        event.target.disabled = false
        event.target.textContent = '拉取企微客户群'
        return alert(result.message || '拉取失败')
      }
      state.data.wecomGroups = result.groups || []
      render()
    }
    panel.querySelectorAll('[data-add]').forEach((btn) => {
      btn.onclick = async () => {
        const result = await api('/api/groups', {
          method: 'POST',
          body: JSON.stringify({ name: btn.dataset.name, chatId: btn.dataset.add, sender: btn.dataset.owner, ownerName: btn.dataset.ownerName, receiveDigest: true })
        })
        if (!result.ok) return alert(result.message)
        await reload()
      }
    })
    panel.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.onclick = async () => {
        await api('/api/groups/toggle', { method: 'POST', body: JSON.stringify({ id: btn.dataset.id, field: 'enabled' }) })
        await reload()
      }
    })
    panel.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm(`把「${btn.dataset.name}」移出推送名单？之后不再往这个群推。`)) return
        const result = await api('/api/groups/remove', { method: 'POST', body: JSON.stringify({ id: btn.dataset.remove }) })
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
      <p class="muted">用户查看帖子微信号后的对接反馈（靠谱 / 未回复 / 疑似诈骗等）</p>
      ${listOrEmpty(data.contactFeedbacks, (item) => `
        <div class="list-item">
          <div class="row"><strong>${esc(item.reasonLabel || item.reason)}</strong><span>${esc(item.tag || '帖子')}</span></div>
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

// 热榜候选的真实统计；null 表示读取到的字段异常，显示「—」而不是 0
function weeklyStats(item) {
  const show = (value) => (value == null ? '<span title="读取失败">—</span>' : value)
  return `浏览 ${show(item.viewCount)} · 点赞 ${show(item.likeCount)} · 评论 ${show(item.commentCount)}`
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

// ---- 黎安攻略（guides 集合 + meta/guide_categories）----
// 三种来源混在小程序同一个信息流：公众号推文（运营录入）、攻略页投稿（人工审核）、首页帖子圈选（运营挑）
const GUIDE_VIEWS = [
  { view: 'list', label: '攻略列表' },
  { view: 'article', label: '添加公众号推文' },
  { view: 'pick', label: '从帖子圈选' },
  { view: 'categories', label: '分类设置' }
]
const GUIDE_TABS = [
  { status: 'pending', label: '待审核' },
  { status: 'approved', label: '已上线' },
  { status: 'offline', label: '已下线 / 未通过' }
]
const GUIDE_TONES = 5
const GUIDE_KIND_LABEL = { article: '公众号推文', post: '攻略投稿', pick: '帖子圈选' }

async function reloadGuides() {
  const result = await api(`/api/guides?status=${encodeURIComponent(state.guideStatus)}`)
  if (!result.ok) return
  state.data = state.data || {}
  state.data.guides = result
  if (state.guideView === 'pick') {
    const posts = await api(`/api/guides/posts?keyword=${encodeURIComponent(state.guidePickKeyword || '')}`)
    state.data.guidePosts = posts.ok ? posts.items : []
  }
  if (state.nav === 'guides') render()
}

function guideThumb(item, categories) {
  if (item.kind === 'article' && item.coverUrl) {
    return `<img class="gd-thumb" src="${esc(item.coverUrl)}" alt="" />`
  }
  const tone = Math.max(0, categories.indexOf(item.category)) % GUIDE_TONES
  return `<div class="gd-thumb gd-tthumb tone-${tone}"><strong>${esc(item.title)}</strong></div>`
}

function guideCategorySelect(attr, categories, current) {
  return `<select ${attr}>${categories.map((c) => (
    `<option value="${esc(c)}" ${c === current ? 'selected' : ''}>${esc(c)}</option>`
  )).join('')}</select>`
}

function guideRow(item, categories, index, total) {
  const status = item.reviewStatus || 'pending'
  const kind = item.kind === 'article' || item.kind === 'pick' ? item.kind : 'post'
  const author = kind === 'article'
    ? ''
    : ` · ${item.anonymous ? '<span class="anon-tag">分身</span> ' : ''}${esc(item.authorName || '')}${item.authorId ? `（${esc(item.authorId)}）` : ''}`
  const catSelect = guideCategorySelect(`data-guide-cat="${esc(item.id)}"`, categories, item.category)
  let ops = ''
  if (status === 'pending') {
    ops = `${catSelect}
      <button type="button" data-guide-act="approve" data-id="${esc(item.id)}">通过</button>
      <button type="button" class="quiet warn" data-guide-act="reject" data-id="${esc(item.id)}">不通过</button>`
  } else if (status === 'approved') {
    const order = `<span class="gd-order">
        <button type="button" class="quiet" data-guide-move="top" data-id="${esc(item.id)}" ${index === 0 ? 'disabled' : ''}>移到最前</button>
        <button type="button" class="quiet" data-guide-move="up" data-id="${esc(item.id)}" ${index === 0 ? 'disabled' : ''}>上移</button>
        <button type="button" class="quiet" data-guide-move="down" data-id="${esc(item.id)}" ${index === total - 1 ? 'disabled' : ''}>下移</button>
      </span>`
    ops = `${order}
      ${kind === 'article' ? `<button type="button" class="quiet" data-guide-edit="${esc(item.id)}">编辑</button>` : ''}
      <button type="button" class="quiet warn" data-guide-act="offline" data-id="${esc(item.id)}">下线</button>`
  } else {
    ops = `${catSelect}
      <button type="button" class="quiet" data-guide-act="restore" data-id="${esc(item.id)}">重新上线</button>
      <button type="button" class="quiet warn" data-guide-act="delete" data-id="${esc(item.id)}">删除</button>`
  }
  const body = item.content
    ? `<details class="gd-body"><summary>看正文${item.imageUrls && item.imageUrls.length ? `（${item.imageUrls.length} 图）` : ''}</summary><p>${esc(item.content)}</p>${(item.imageUrls || []).map((u) => `<img src="${esc(u)}" alt="" />`).join('')}</details>`
    : (kind === 'pick' && item.summary ? `<span class="meta">${esc(item.summary)}</span>` : '')
  return `
    <div class="gd-row">
      ${guideThumb(item, categories)}
      <div class="gd-copy">
        <strong>${status === 'approved' ? `<span class="gd-rank">${index + 1}</span>` : ''}${esc(item.title)}</strong>
        <span class="meta"><span class="gd-kind ${kind}">${GUIDE_KIND_LABEL[kind]}</span> ${esc(item.category || '')}${author} · ${formatTime(item.publishedAt || item.createdAt)}${status === 'rejected' ? ` · 未通过：${esc(item.reviewNote || '')}` : ''}</span>
        ${body}
        ${kind === 'article' ? `<a class="meta gd-link" href="${esc(item.articleUrl)}" target="_blank" rel="noopener">${esc(item.articleUrl)}</a>` : ''}
      </div>
      <div class="gd-ops">${ops}</div>
    </div>`
}

function guideListView(guides, categories) {
  const counts = guides.counts || {}
  return `
    <div class="card">
      <div class="gd-tabs">
        ${GUIDE_TABS.map((tab) => {
          const n = tab.status === 'offline' ? (counts.offline || 0) + (counts.rejected || 0) : (counts[tab.status] || 0)
          return `<button type="button" class="${state.guideStatus === tab.status ? 'active' : ''}" data-guide-tab="${tab.status}">${tab.label} ${n}</button>`
        }).join('')}
      </div>
      <p class="muted">${state.guideStatus === 'pending' ? '用户在小程序「黎安攻略」里的投稿，机审通过后全部在这里等人工审核，通过才会在小程序里显示。' : ''}${state.guideStatus === 'approved' ? '序号就是小程序「黎安攻略」里的显示顺序（「全部」分类下）；新上线的默认排在最前。' : ''}</p>
      ${(guides.items || []).length
        ? guides.items.map((item, index, all) => guideRow(item, categories, index, all.length)).join('')
        : '<p class="muted">这里还没有内容。</p>'}
    </div>`
}

function guideArticleView(categories) {
  const draft = state.guideDraft || { id: '', title: '', summary: '', category: categories[0] || '', coverMode: 'image', cover: '', coverUrl: '', articleUrl: '' }
  const textCover = draft.coverMode === 'text'
  const tone = Math.max(0, categories.indexOf(draft.category)) % GUIDE_TONES
  state.guideDraft = draft
  const local = (state.data && state.data.overview && state.data.overview.mode) !== 'cloud'
  return `
    <div class="card">
      <h3>${draft.id ? '编辑公众号推文' : '添加公众号推文'}</h3>
      <p class="muted">填推文链接，保存后直接出现在小程序「黎安攻略」，用户点开直接进推文。封面可以上传横版图（2.35:1，如 900×383），也可以用文字封面：按标题和副标题自动排版，样式和用户投稿一致。</p>
      <div class="gd-form">
        <div>
          ${textCover
            ? `<div class="gd-cover-pick gd-tthumb tone-${tone} gd-text-preview"><strong>${esc(draft.title || '标题')}</strong>${draft.summary ? `<span>${esc(draft.summary)}</span>` : ''}</div>`
            : `<div class="gd-cover-pick">${draft.coverUrl ? `<img src="${esc(draft.coverUrl)}" alt="" />` : '<span class="muted">还没上传封面</span>'}</div>`}
          <div class="gd-cover-mode">
            <label class="check-row"><input type="radio" name="gd-cover-mode" value="image" ${textCover ? '' : 'checked'} /><span>上传封面图</span></label>
            <label class="check-row"><input type="radio" name="gd-cover-mode" value="text" ${textCover ? 'checked' : ''} /><span>用文字封面</span></label>
          </div>
        </div>
        <div class="gd-fields">
          ${textCover ? '' : `<div class="row gap">
            <label class="upload-btn">上传封面<input id="gd-file" type="file" accept="image/jpeg,image/png,image/webp" hidden /></label>
            <span id="gd-upload-status" class="muted"></span>
          </div>`}
          <input id="gd-title" maxlength="40" placeholder="标题" value="${esc(draft.title)}" />
          <input id="gd-summary" maxlength="40" placeholder="副标题（选填，显示在文字封面上）" value="${esc(draft.summary || '')}" />
          <input id="gd-url" placeholder="推文链接 https://mp.weixin.qq.com/..." value="${esc(draft.articleUrl)}" />
          ${guideCategorySelect('id="gd-category"', categories, draft.category)}
          <div class="row gap">
            <button id="gd-save" type="button">${draft.id ? '保存修改' : '保存并上线'}</button>
            ${draft.id ? '<button id="gd-cancel" type="button" class="quiet">取消编辑</button>' : ''}
          </div>
          ${local ? '<p class="muted">当前是本地演示模式：上传的封面只用于后台预览，小程序读不到。</p>' : ''}
        </div>
      </div>
    </div>`
}

function guidePickView(categories) {
  const posts = (state.data && state.data.guidePosts) || []
  return `
    <div class="card">
      <h3>从帖子圈选</h3>
      <p class="muted">从首页已通过的帖子里挑，设为攻略后在小程序「黎安攻略」里显示成横版卡片，点开进入原帖（评论、点赞都在原帖）。原帖被删或下架时，攻略里也会自动不显示。</p>
      <div class="row gap">
        <input id="gd-pick-keyword" placeholder="搜标题或正文" value="${esc(state.guidePickKeyword || '')}" />
        <button id="gd-pick-search" type="button">搜索</button>
      </div>
      ${posts.length ? posts.map((post) => `
        <div class="gd-pick-row">
          <div class="gd-copy">
            <strong>${esc(post.title)}</strong>
            ${post.excerpt && post.excerpt !== post.title ? `<span class="meta gd-excerpt">${esc(post.excerpt)}</span>` : ''}
            <span class="meta">${post.tag ? `${esc(post.tag)} · ` : ''}${post.anonymous ? '<span class="anon-tag">分身</span> ' : ''}${esc(post.authorName)} · ${formatTime(post.createdAt)} · 赞 ${post.likeCount} · 评 ${post.commentCount}</span>
          </div>
          <div class="gd-ops">
            ${post.picked
              ? '<span class="muted">已在攻略里</span>'
              : `${guideCategorySelect(`data-pick-cat="${esc(post.contentId)}"`, categories, categories[0])}
                 <button type="button" data-guide-pick="${esc(post.contentId)}" data-type="${esc(post.contentType)}">设为攻略</button>`}
          </div>
        </div>`).join('') : '<p class="muted">没有找到已通过的帖子。</p>'}
    </div>`
}

function guideCategoryView(categories) {
  return `
    <div class="card">
      <h3>分类设置</h3>
      <p class="muted">小程序攻略页顶部的分类，按顺序显示，用顿号或逗号分隔，最多 12 个、每个最多 6 个字。删掉的分类下已有的攻略不会被删，只是不再单独显示这个分类。</p>
      <div class="row gap">
        <input id="gd-cats" value="${esc(categories.join('、'))}" />
        <button id="gd-cats-save" type="button">保存分类</button>
      </div>
    </div>`
}

function renderGuides(panel, data) {
  const guides = data || { items: [], categories: [], counts: {} }
  const categories = guides.categories || []
  const view = state.guideView || 'list'
  const body = view === 'article' ? guideArticleView(categories)
    : view === 'pick' ? guidePickView(categories)
      : view === 'categories' ? guideCategoryView(categories)
        : guideListView(guides, categories)
  panel.innerHTML = `
    <div class="subtabs">
      ${GUIDE_VIEWS.map((item) => `<button type="button" data-guide-view="${item.view}" class="${item.view === view ? 'active' : ''}">${item.label}${item.view === 'list' && (guides.counts || {}).pending ? ` · 待审 ${guides.counts.pending}` : ''}</button>`).join('')}
    </div>
    ${body}`

  panel.querySelectorAll('[data-guide-view]').forEach((btn) => {
    btn.onclick = async () => {
      if (btn.dataset.guideView === state.guideView) return
      state.guideView = btn.dataset.guideView
      if (state.guideView === 'pick') await reloadGuides()
      else render()
    }
  })
  if (view === 'article') bindGuideArticle(panel)
  if (view === 'pick') bindGuidePick(panel)
  if (view === 'categories') bindGuideCategories(panel)
  if (view === 'list') bindGuideList(panel, guides)
}

function bindGuideArticle(panel) {
  const readDraft = () => ({
    ...state.guideDraft,
    title: panel.querySelector('#gd-title').value.trim(),
    summary: panel.querySelector('#gd-summary').value.trim(),
    articleUrl: panel.querySelector('#gd-url').value.trim(),
    category: panel.querySelector('#gd-category').value
  })
  panel.querySelectorAll('[name="gd-cover-mode"]').forEach((radio) => {
    radio.onchange = () => {
      state.guideDraft = { ...readDraft(), coverMode: radio.value }
      render()
    }
  })
  // 文字封面：改标题、副标题、分类时预览跟着变
  const preview = panel.querySelector('.gd-text-preview')
  if (preview) {
    const refresh = () => {
      const d = readDraft()
      const cats = (state.data.guides && state.data.guides.categories) || []
      preview.className = `gd-cover-pick gd-tthumb tone-${Math.max(0, cats.indexOf(d.category)) % GUIDE_TONES} gd-text-preview`
      preview.innerHTML = `<strong>${esc(d.title || '标题')}</strong>${d.summary ? `<span>${esc(d.summary)}</span>` : ''}`
    }
    ;['#gd-title', '#gd-summary'].forEach((sel) => { panel.querySelector(sel).oninput = refresh })
    panel.querySelector('#gd-category').onchange = refresh
  }
  const status = panel.querySelector('#gd-upload-status')
  const fileInput = panel.querySelector('#gd-file')
  if (fileInput) fileInput.onchange = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    status.textContent = '上传中…'
    try {
      const dataUrl = await shrinkImage(file)
      const result = await api('/api/guides/upload', {
        method: 'POST',
        body: JSON.stringify({ type: 'image/jpeg', data: dataUrl })
      })
      if (!result.ok) {
        status.textContent = result.message || '上传失败'
        return
      }
      state.guideDraft = { ...readDraft(), cover: result.src, coverUrl: result.previewUrl }
      render()
    } catch (err) {
      status.textContent = (err && err.message) || '上传失败'
    }
  }
  const saveBtn = panel.querySelector('#gd-save')
  saveBtn.onclick = async () => {
    saveBtn.disabled = true
    const result = await api('/api/guides/article', { method: 'POST', body: JSON.stringify(readDraft()) })
    saveBtn.disabled = false
    if (!result.ok) return alert(result.message || '保存失败')
    state.guideDraft = null
    state.guideView = 'list'
    state.guideStatus = 'approved'
    await reloadGuides()
  }
  const cancel = panel.querySelector('#gd-cancel')
  if (cancel) {
    cancel.onclick = () => {
      state.guideDraft = null
      state.guideView = 'list'
      render()
    }
  }
}

function bindGuidePick(panel) {
  const search = async () => {
    state.guidePickKeyword = panel.querySelector('#gd-pick-keyword').value.trim()
    await reloadGuides()
  }
  panel.querySelector('#gd-pick-search').onclick = search
  panel.querySelector('#gd-pick-keyword').onkeydown = (e) => {
    if (e.key === 'Enter') search()
  }
  panel.querySelectorAll('[data-guide-pick]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.guidePick
      const select = panel.querySelector(`[data-pick-cat="${CSS.escape(id)}"]`)
      btn.disabled = true
      const result = await api('/api/guides/pick', {
        method: 'POST',
        body: JSON.stringify({ contentType: btn.dataset.type, contentId: id, category: select ? select.value : '' })
      })
      btn.disabled = false
      if (!result.ok) return alert(result.message || '设为攻略失败')
      await reloadGuides()
    }
  })
}

function bindGuideCategories(panel) {
  panel.querySelector('#gd-cats-save').onclick = async () => {
    const list = panel.querySelector('#gd-cats').value
    const result = await api('/api/guides/categories', { method: 'POST', body: JSON.stringify({ list }) })
    if (!result.ok) return alert(result.message || '保存失败')
    alert('分类已保存，小程序最多 5 分钟后生效')
    await reloadGuides()
  }
}

function bindGuideList(panel, guides) {
  panel.querySelectorAll('[data-guide-edit]').forEach((btn) => {
    btn.onclick = () => {
      const item = (guides.items || []).find((row) => row.id === btn.dataset.guideEdit)
      if (!item) return
      state.guideDraft = {
        id: item.id,
        title: item.title,
        summary: item.summary || '',
        category: item.category,
        coverMode: item.cover ? 'image' : 'text',
        cover: item.cover,
        coverUrl: item.coverUrl,
        articleUrl: item.articleUrl
      }
      state.guideView = 'article'
      render()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  })
  panel.querySelectorAll('[data-guide-move]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true
      const result = await api('/api/guides/reorder', {
        method: 'POST',
        body: JSON.stringify({ id: btn.dataset.id, action: btn.dataset.guideMove })
      })
      if (!result.ok) {
        btn.disabled = false
        return alert(result.message || '调整失败')
      }
      await reloadGuides()
    }
  })
  panel.querySelectorAll('[data-guide-tab]').forEach((btn) => {
    btn.onclick = async () => {
      state.guideStatus = btn.dataset.guideTab
      await reloadGuides()
    }
  })
  panel.querySelectorAll('[data-guide-act]').forEach((btn) => {
    btn.onclick = async () => {
      const action = btn.dataset.guideAct
      const id = btn.dataset.id
      const select = panel.querySelector(`[data-guide-cat="${CSS.escape(id)}"]`)
      const body = { id, action, category: select ? select.value : '' }
      if (action === 'reject') {
        const note = prompt('不通过的原因（选填，仅后台可见）', '')
        if (note === null) return
        body.note = note
      }
      if (action === 'delete' && !confirm('删除后不能恢复，确定删除？')) return
      if (action === 'offline' && !confirm('下线后小程序里不再显示，可以在「已下线」里重新上线。确定下线？')) return
      btn.disabled = true
      const result = await api('/api/guides/status', { method: 'POST', body: JSON.stringify(body) })
      btn.disabled = false
      if (!result.ok) return alert(result.message || '操作失败')
      await reloadGuides()
    }
  })
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
  if (nav === 'guides') return reloadGuides()
  if (nav === 'digest') return refreshDigest()
  if (nav === 'reports') return reloadReports()
  if (nav === 'content') return reloadContent()
  if (nav === 'modlogs') return reloadModLogs()
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
    const [result, push] = await Promise.all([api('/api/groups'), api('/api/wecom/push-status')])
    if (!result.ok) return
    state.data.groups = result.groups || []
    state.data.wecom = result.wecom || {}
    state.data.pushStatus = (push && push.ok && push.status) || null
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
