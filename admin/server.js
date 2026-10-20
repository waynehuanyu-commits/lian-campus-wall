const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { loadEnv } = require('../server/load-env')
const service = require('./lib/service')
const staff = require('./lib/staff')

loadEnv()
const localEnv = path.join(__dirname, '.env')
if (fs.existsSync(localEnv)) {
  fs.readFileSync(localEnv, 'utf8').split(/\r?\n/).forEach((line) => {
    const text = line.trim()
    if (!text || text.startsWith('#')) return
    const index = text.indexOf('=')
    if (index < 1) return
    const key = text.slice(0, index).trim()
    const value = text.slice(index + 1).trim()
    if (!process.env[key]) process.env[key] = value
  })
}

const PORT = Number(process.env.PORT || 8787)
const ADMIN_ACCOUNT = process.env.ADMIN_ACCOUNT || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
const sessions = new Map()

function json(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

function parseCookies(req) {
  const header = req.headers.cookie || ''
  return Object.fromEntries(header.split(';').map((part) => {
    const index = part.indexOf('=')
    if (index < 0) return []
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]
  }).filter((item) => item.length))
}

function currentSession(req) {
  const token = parseCookies(req).admin_session
  if (!token) return null
  const session = sessions.get(token)
  if (!session || session.expireAt < Date.now()) {
    sessions.delete(token)
    return null
  }
  return session
}

function requireAdmin(req, res) {
  const session = currentSession(req)
  if (!session) {
    json(res, 401, { ok: false, message: '请先登录' })
    return null
  }
  return session
}

function requireRoot(req, res) {
  const session = requireAdmin(req, res)
  if (!session) return null
  if (session.role && session.role !== 'root') {
    json(res, 403, { ok: false, message: '只有主管理员可以操作' })
    return null
  }
  return session
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function serveStatic(req, res) {
  const url = req.url === '/' ? '/index.html' : req.url.split('?')[0]
  const file = path.join(__dirname, 'public', path.normalize(url).replace(/^(\.\.[/\\])+/, ''))
  if (!file.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403)
    res.end()
    return
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    const ext = path.extname(file)
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8'
    }
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    })
    res.end(data)
  })
}

const routes = {
  'POST /api/login': async (req, res) => {
    const body = await readBody(req)
    const account = String(body.account || '').trim()
    const password = String(body.password || '')
    let sessionUser = null
    if (ADMIN_PASSWORD && account === ADMIN_ACCOUNT && password === ADMIN_PASSWORD) {
      sessionUser = { account, role: 'root', staffId: '', name: '主管理员' }
    } else {
      const staffUser = await staff.verifyStaff(account, password)
      if (!staffUser.ok) {
        json(res, account === ADMIN_ACCOUNT && !ADMIN_PASSWORD ? 500 : 401, {
          ok: false,
          message: account === ADMIN_ACCOUNT && !ADMIN_PASSWORD
            ? '服务器未配置 ADMIN_PASSWORD'
            : (staffUser.message || '账号或密码不正确')
        })
        return
      }
      sessionUser = {
        account: staffUser.account,
        role: 'staff',
        staffId: staffUser.id,
        name: staffUser.name || staffUser.account
      }
    }
    const token = crypto.randomBytes(24).toString('hex')
    sessions.set(token, {
      ...sessionUser,
      expireAt: Date.now() + 7 * 24 * 3600 * 1000
    })
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': `admin_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 24 * 3600}`
    })
    res.end(JSON.stringify({ ok: true, account: sessionUser.account, role: sessionUser.role, name: sessionUser.name }))
  },

  'POST /api/logout': async (req, res) => {
    const token = parseCookies(req).admin_session
    if (token) sessions.delete(token)
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'admin_session=; HttpOnly; Path=/; Max-Age=0'
    })
    res.end(JSON.stringify({ ok: true }))
  },

  'GET /api/session': async (req, res) => {
    const session = currentSession(req)
    json(res, 200, {
      ok: !!session,
      account: session && session.account,
      role: session && (session.role || 'root'),
      name: session && (session.name || session.account)
    })
  },

  'GET /api/dashboard': async (req, res) => {
    if (!requireAdmin(req, res)) return
    json(res, 200, { ok: true, data: await service.dashboard() })
  },

  'GET /api/keywords': async (req, res) => {
    if (!requireAdmin(req, res)) return
    json(res, 200, { ok: true, list: await service.listKeywords() })
  },

  'GET /api/groups': async (req, res) => {
    if (!requireAdmin(req, res)) return
    json(res, 200, { ok: true, groups: await service.listGroups(), wecom: service.wecomStatus() })
  },

  'GET /api/more': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const [securityLogs, contactFeedbacks] = await Promise.all([
      service.listSecurityLogs(),
      service.listContactFeedbacks()
    ])
    json(res, 200, {
      ok: true,
      securityLogs: securityLogs.slice(0, 40),
      contactFeedbacks: contactFeedbacks.slice(0, 40)
    })
  },

  'GET /api/school': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const url = new URL(req.url, 'http://127.0.0.1')
    json(res, 200, { ok: true, list: await service.listSchoolRequests(url.searchParams.get('status') || 'pending') })
  },

  'GET /api/reviews': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const url = new URL(req.url, 'http://127.0.0.1')
    json(res, 200, { ok: true, list: await service.listContentReviews(url.searchParams.get('status') || 'queue') })
  },

  'GET /api/reviews/detail': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const url = new URL(req.url, 'http://127.0.0.1')
    json(res, 200, await service.getReviewDetail(url.searchParams.get('type'), url.searchParams.get('id')))
  },

  'POST /api/reviews': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const body = await readBody(req)
    json(res, 200, await service.reviewContent(body.type, body.id, body))
  },

  'POST /api/local/reset': async (req, res) => {
    if (!requireAdmin(req, res)) return
    json(res, 200, await service.resetLocalDemo())
  },

  'GET /api/mode': async (req, res) => {
    if (!requireAdmin(req, res)) return
    json(res, 200, { ok: true, mode: service.mode() })
  },

  'GET /api/lexicons': async (req, res) => {
    if (!requireAdmin(req, res)) return
    json(res, 200, { ok: true, ...(await service.listLexicons()) })
  },

  'POST /api/lexicons': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const body = await readBody(req)
    json(res, 200, await service.addLexiconTerm(body.signal, body.word))
  },

  'POST /api/lexicons/toggle': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const body = await readBody(req)
    json(res, 200, await service.toggleLexiconTerm(body.id, body.enabled))
  },

  'DELETE /api/lexicons': async (req, res) => {
    if (!requireAdmin(req, res)) return
    json(res, 200, await service.removeLexiconTerm((await readBody(req)).id))
  },

  'POST /api/keywords': async (req, res) => {
    if (!requireAdmin(req, res)) return
    json(res, 200, await service.addKeyword((await readBody(req)).word))
  },

  'DELETE /api/keywords': async (req, res) => {
    if (!requireAdmin(req, res)) return
    json(res, 200, await service.removeKeyword((await readBody(req)).word))
  },

  'POST /api/accounts/whitelist': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const body = await readBody(req)
    json(res, 200, await service.setPostWhitelist(body.id, body.enabled))
  },

  'GET /api/whitelist': async (req, res) => {
    if (!requireAdmin(req, res)) return
    json(res, 200, { ok: true, list: await service.listPostWhitelist() })
  },

  'POST /api/accounts/official-login': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const body = await readBody(req)
    json(res, 200, await service.setOfficialLogin(body.id, body.enabled))
  },

  'GET /api/official-login': async (req, res) => {
    if (!requireAdmin(req, res)) return
    json(res, 200, { ok: true, list: await service.listOfficialLogin() })
  },

  'GET /api/accounts/search': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const url = new URL(req.url, 'http://127.0.0.1')
    json(res, 200, { ok: true, list: await service.searchAccounts(url.searchParams.get('q') || '') })
  },

  'POST /api/accounts/app-admin': async (req, res) => {
    if (!requireRoot(req, res)) return
    const body = await readBody(req)
    json(res, 200, await service.setAppAdmin(body.id, body.enabled))
  },

  'GET /api/staff': async (req, res) => {
    const session = requireAdmin(req, res)
    if (!session) return
    json(res, 200, {
      ok: true,
      role: session.role || 'root',
      account: session.account,
      list: !session.role || session.role === 'root' ? await staff.listStaff() : []
    })
  },

  'POST /api/staff': async (req, res) => {
    if (!requireRoot(req, res)) return
    const body = await readBody(req)
    json(res, 200, await staff.createStaff(body))
  },

  'POST /api/staff/password': async (req, res) => {
    const session = requireAdmin(req, res)
    if (!session) return
    const body = await readBody(req)
    const account = String(body.account || '').trim()
    if (session.role !== 'root' && account !== session.account) {
      json(res, 403, { ok: false, message: '只能修改自己的密码' })
      return
    }
    json(res, 200, await staff.setStaffPassword(account, body.password))
  },

  'POST /api/staff/status': async (req, res) => {
    if (!requireRoot(req, res)) return
    const body = await readBody(req)
    json(res, 200, await staff.setStaffStatus(body.account, body.status))
  },

  'POST /api/staff/delete': async (req, res) => {
    if (!requireRoot(req, res)) return
    const body = await readBody(req)
    const result = await staff.removeStaff(body.account)
    if (result.ok) {
      for (const [token, session] of sessions) {
        if (session.account === result.account) sessions.delete(token)
      }
    }
    json(res, 200, result)
  },

  'POST /api/accounts/status': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const body = await readBody(req)
    json(res, 200, await service.setAccountStatus(body.id, body))
  },

  'GET /api/accounts': async (req, res) => {
    if (!requireAdmin(req, res)) return
    json(res, 200, { ok: true, list: await service.listAccounts() })
  },

  'GET /api/reports': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const url = new URL(req.url, 'http://127.0.0.1')
    json(res, 200, { ok: true, list: await service.listReports(url.searchParams.get('status') || 'pending') })
  },

  'POST /api/reports/resolve': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const body = await readBody(req)
    json(res, 200, await service.resolveReport(body.id, body))
  },

  'POST /api/school/set': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const body = await readBody(req)
    json(res, 200, await service.setUserSchool(body.id || body.userId, body))
  },

  'POST /api/school/review': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const body = await readBody(req)
    json(res, 200, await service.reviewSchoolChange(body.id, body))
  },

  'GET /api/student-auth': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const url = new URL(req.url, 'http://127.0.0.1')
    json(res, 200, { ok: true, list: await service.listStudentAuthRequests(url.searchParams.get('status') || 'pending') })
  },

  'POST /api/student-auth/review': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const body = await readBody(req)
    json(res, 200, await service.reviewStudentAuth(body.id, body))
  },

  'GET /api/digest': async (req, res) => {
    if (!requireAdmin(req, res)) return
    json(res, 200, { ok: true, ...(await service.digestState()) })
  },

  'POST /api/digest/flush': async (req, res) => {
    if (!requireAdmin(req, res)) return
    json(res, 200, await service.flushDigest(true))
  },

  'POST /api/digest/by-time': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const body = await readBody(req)
    json(res, 200, await service.buildDigestByTime(body.range))
  },

  'POST /api/digest/custom': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const body = await readBody(req)
    json(res, 200, await service.buildDigestFromSelection(body.items))
  },

  'POST /api/digest/paste': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const body = await readBody(req)
    json(res, 200, await service.refillDigestPaste(body.id))
  },

  'GET /api/wecom/status': async (req, res) => {
    if (!requireAdmin(req, res)) return
    json(res, 200, { ok: true, wecom: service.wecomStatus() })
  },

  'GET /api/wecom/groups': async (req, res) => {
    if (!requireAdmin(req, res)) return
    json(res, 200, await service.pullWecomGroups())
  },

  'POST /api/wecom/sync': async (req, res) => {
    if (!requireAdmin(req, res)) return
    json(res, 200, await service.syncTestGroup())
  },

  'POST /api/groups': async (req, res) => {
    if (!requireAdmin(req, res)) return
    json(res, 200, await service.addGroup(await readBody(req)))
  },

  'PUT /api/groups': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const body = await readBody(req)
    json(res, 200, await service.updateGroup(body.id, body))
  },

  'POST /api/groups/toggle': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const body = await readBody(req)
    json(res, 200, await service.toggleGroup(body.id, body.field))
  },

  'GET /api/weekly-hot': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const url = new URL(req.url, 'http://127.0.0.1')
    json(res, 200, { ok: true, ...(await service.weeklyHotState(url.searchParams.get('keyword') || '')) })
  },

  'POST /api/weekly-hot/meta': async (req, res) => {
    if (!requireAdmin(req, res)) return
    json(res, 200, await service.updateWeeklyHotMeta(await readBody(req)))
  },

  'POST /api/weekly-hot/add': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const body = await readBody(req)
    json(res, 200, await service.addWeeklyHotItem(body.contentId, body.contentType))
  },

  'POST /api/weekly-hot/remove': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const body = await readBody(req)
    json(res, 200, await service.removeWeeklyHotItem(body.contentId, body.contentType))
  },

  'POST /api/weekly-hot/move': async (req, res) => {
    if (!requireAdmin(req, res)) return
    const body = await readBody(req)
    json(res, 200, await service.moveWeeklyHotItem(body.contentId, body.direction, body.contentType))
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const key = `${req.method} ${req.url.split('?')[0]}`
    if (routes[key]) {
      await routes[key](req, res)
      return
    }
    if (req.url.startsWith('/api/')) {
      json(res, 404, { ok: false, message: '接口不存在' })
      return
    }
    serveStatic(req, res)
  } catch (err) {
    json(res, 500, { ok: false, message: err.message || '服务器错误' })
  }
})

server.listen(PORT, () => {
  const mode = service.mode()
  console.log(`黎安话事运营后台: http://127.0.0.1:${PORT}`)
  console.log(`数据模式: ${mode === 'local' ? '本地演示（未配云库或 ADMIN_LOCAL=1）' : '微信云开发'}`)
})
