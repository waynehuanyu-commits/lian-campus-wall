const crypto = require('crypto')
const db = require('./db')

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex')
  return { salt, hash }
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false
  const next = crypto.scryptSync(String(password), salt, 32)
  const prev = Buffer.from(String(hash), 'hex')
  if (prev.length !== next.length) return false
  return crypto.timingSafeEqual(prev, next)
}

function cleanAccount(account) {
  return String(account || '').trim()
}

function publicStaff(row) {
  return {
    id: row.id,
    account: row.account,
    name: row.name || row.account,
    status: row.status || 'active',
    createdAt: row.createdAt || 0,
    updatedAt: row.updatedAt || 0
  }
}

async function listStaff() {
  await db.ensureCollection('admin_staff')
  const rows = await db.allDocs('admin_staff')
  return rows
    .map(publicStaff)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

async function verifyStaff(account, password) {
  const id = cleanAccount(account)
  if (!id || !password) return { ok: false, message: '账号或密码不正确' }
  let row = null
  try {
    row = await db.getDoc('admin_staff', id)
  } catch (err) {
    return { ok: false, message: '账号或密码不正确' }
  }
  if (!row || !row.passwordHash) return { ok: false, message: '账号或密码不正确' }
  if (row.status === 'disabled') return { ok: false, message: '这个运营账号已停用' }
  if (!verifyPassword(password, row.salt, row.passwordHash)) {
    return { ok: false, message: '账号或密码不正确' }
  }
  return { ok: true, ...publicStaff(row) }
}

async function createStaff({ account, name, password } = {}) {
  const id = cleanAccount(account)
  if (!/^[A-Za-z0-9_]{3,20}$/.test(id)) {
    return { ok: false, message: '账号用 3 到 20 位字母、数字或下划线' }
  }
  if (id.toLowerCase() === 'admin') return { ok: false, message: '这个账号名留给主管理员' }
  const text = String(password || '')
  if (text.length < 6) return { ok: false, message: '密码至少 6 位' }
  await db.ensureCollection('admin_staff')
  const existing = await db.getDoc('admin_staff', id)
  if (existing) return { ok: false, message: '这个账号已经有了' }
  const { salt, hash } = hashPassword(text)
  const row = {
    id,
    account: id,
    name: String(name || '').trim() || id,
    salt,
    passwordHash: hash,
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  await db.setDoc('admin_staff', id, row)
  return { ok: true, staff: publicStaff(row) }
}

async function setStaffPassword(account, password) {
  const id = cleanAccount(account)
  const row = await db.getDoc('admin_staff', id)
  if (!row) return { ok: false, message: '运营账号不存在' }
  const text = String(password || '')
  if (text.length < 6) return { ok: false, message: '密码至少 6 位' }
  const { salt, hash } = hashPassword(text)
  const next = { ...row, salt, passwordHash: hash, updatedAt: Date.now() }
  await db.setDoc('admin_staff', id, next)
  return { ok: true, staff: publicStaff(next) }
}

async function removeStaff(account) {
  const id = cleanAccount(account)
  if (!id) return { ok: false, message: '请选择要删除的账号' }
  if (id.toLowerCase() === 'admin') return { ok: false, message: '主管理员不能从这里删除' }
  const row = await db.getDoc('admin_staff', id)
  if (!row) return { ok: false, message: '运营账号不存在' }
  await db.removeDoc('admin_staff', id)
  return { ok: true, account: id, message: '已删除' }
}

async function setStaffStatus(account, status) {
  const id = cleanAccount(account)
  const row = await db.getDoc('admin_staff', id)
  if (!row) return { ok: false, message: '运营账号不存在' }
  const nextStatus = status === 'disabled' ? 'disabled' : 'active'
  const next = { ...row, status: nextStatus, updatedAt: Date.now() }
  await db.setDoc('admin_staff', id, next)
  return { ok: true, staff: publicStaff(next) }
}

module.exports = {
  listStaff,
  verifyStaff,
  createStaff,
  setStaffPassword,
  setStaffStatus,
  removeStaff
}
