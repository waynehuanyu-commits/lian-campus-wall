const SESSION_KEY = 'cw_admin_session'
const DEMO_ACCOUNT = 'admin'
const DEMO_PASSWORD = 'admin888'
const SESSION_DAYS = 7

function getSession() {
  return wx.getStorageSync(SESSION_KEY) || null
}

function isLoggedIn() {
  const session = getSession()
  if (!session || !session.expireAt) return false
  if (Date.now() > session.expireAt) {
    wx.removeStorageSync(SESSION_KEY)
    return false
  }
  return true
}

function login(account, password) {
  const name = String(account || '').trim()
  const pwd = String(password || '').trim()
  if (!name || !pwd) {
    return { ok: false, message: '请输入账号和密码' }
  }
  if (name !== DEMO_ACCOUNT || pwd !== DEMO_PASSWORD) {
    return { ok: false, message: '账号或密码不正确' }
  }
  const session = {
    account: DEMO_ACCOUNT,
    role: 'admin',
    loginAt: Date.now(),
    expireAt: Date.now() + SESSION_DAYS * 24 * 3600 * 1000
  }
  wx.setStorageSync(SESSION_KEY, session)
  return { ok: true, session }
}

function logout() {
  wx.removeStorageSync(SESSION_KEY)
}

function ensureAdmin() {
  if (isLoggedIn()) return true
  wx.redirectTo({
    url: '/packageAdmin/login/login',
    fail() {
      wx.reLaunch({ url: '/packageAdmin/login/login' })
    }
  })
  return false
}

module.exports = {
  DEMO_ACCOUNT,
  DEMO_PASSWORD,
  getSession,
  isLoggedIn,
  login,
  logout,
  ensureAdmin
}
