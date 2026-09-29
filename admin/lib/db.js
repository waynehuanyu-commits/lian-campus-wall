const cloudbase = require('@cloudbase/node-sdk')
const localDb = require('./local-db')

let app = null

function useLocal() {
  return localDb.isLocalMode()
}

function getDb() {
  if (useLocal()) {
    throw new Error('当前是本地演示模式，不应调用云数据库')
  }
  if (!process.env.TCB_ENV || !process.env.TCB_SECRET_ID || !process.env.TCB_SECRET_KEY) {
    throw new Error('请先在 admin/.env 配置 TCB_ENV / TCB_SECRET_ID / TCB_SECRET_KEY，或设 ADMIN_LOCAL=1')
  }
  if (!app) {
    app = cloudbase.init({
      env: process.env.TCB_ENV,
      secretId: process.env.TCB_SECRET_ID,
      secretKey: process.env.TCB_SECRET_KEY
    })
  }
  return app.database()
}

async function ensureCollection(name) {
  if (useLocal()) return
  try {
    await getDb().createCollection(name)
  } catch (err) {
    // 集合已存在时云端会报错，忽略即可
  }
}

async function countDocs(name, where) {
  if (useLocal()) {
    const rows = await localDb.allDocs(name)
    if (!where) return rows.length
    return rows.filter((item) => Object.keys(where).every((key) => item[key] === where[key])).length
  }
  try {
    const database = getDb()
    let ref = database.collection(name)
    if (where) ref = ref.where(where)
    const res = await ref.count()
    if (res && typeof res.total === 'number') return res.total
    if (res && res.data && typeof res.data.total === 'number') return res.data.total
    return 0
  } catch (err) {
    console.warn('[countDocs]', name, err && err.message)
    return 0
  }
}

async function allDocs(name, where) {
  if (useLocal()) return localDb.allDocs(name, where)
  const db = getDb()
  let ref = db.collection(name)
  if (where) ref = ref.where(where)
  const res = await ref.limit(200).get()
  return res.data || []
}

/** 按字段取值查询，只返回命中的文档，避免审帖把整表读回来 */
async function findByField(name, field, values, limit = 40) {
  const list = (Array.isArray(values) ? values : [values]).filter(Boolean)
  if (!list.length) return []
  if (useLocal()) {
    const rows = await localDb.allDocs(name)
    return rows.filter((item) => list.includes(item[field])).slice(0, limit)
  }
  const database = getDb()
  const _ = database.command
  const res = await database.collection(name).where({
    [field]: list.length === 1 ? list[0] : _.in(list)
  }).limit(limit).get()
  return res.data || []
}

async function getDoc(name, id) {
  if (useLocal()) return localDb.getDoc(name, id)
  const db = getDb()
  const res = await db.collection(name).doc(id).get()
  const data = res.data
  if (Array.isArray(data)) return data[0] || null
  return data || null
}

function writable(data) {
  const next = { ...(data || {}) }
  delete next._id
  delete next._openid
  return next
}

async function setDoc(name, id, data) {
  if (useLocal()) return localDb.setDoc(name, id, data)
  const db = getDb()
  const body = writable(data)
  await db.collection(name).doc(id).set(body)
  return { ...body, id }
}

async function updateDoc(name, id, data) {
  if (useLocal()) return localDb.updateDoc(name, id, data)
  const db = getDb()
  await db.collection(name).doc(id).update(writable(data))
}

async function removeDoc(name, id) {
  if (useLocal()) return localDb.removeDoc(name, id)
  const db = getDb()
  await db.collection(name).doc(id).remove()
}

function isCloudFileId(value) {
  return /^cloud:\/\//.test(String(value || ''))
}

/** 管理端把 cloud:// 换成临时 HTTPS，浏览器才能显示帖子图 */
async function resolveCloudUrls(fileIDs = []) {
  const list = Array.from(new Set((fileIDs || []).map((item) => String(item || '')).filter(isCloudFileId)))
  const map = {}
  if (!list.length || useLocal()) return map
  if (!process.env.TCB_ENV || !process.env.TCB_SECRET_ID || !process.env.TCB_SECRET_KEY) return map
  if (!app) getDb()
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50)
    try {
      const res = await app.getTempFileURL({
        fileList: chunk.map((fileID) => ({ fileID, maxAge: 60 * 60 * 6 }))
      })
      ;((res && res.fileList) || []).forEach((row) => {
        const id = row.fileID || row.fileid
        const url = row.tempFileURL || row.download_url || ''
        const ok = url && (row.status === 0 || row.status === '0' || row.status == null)
        if (id && ok) map[id] = url
      })
    } catch (err) {
      console.warn('[resolveCloudUrls]', err && err.message)
    }
  }
  return map
}

function applyCloudUrls(urls, map) {
  return (Array.isArray(urls) ? urls : []).map((item) => map[item] || item)
}

module.exports = {
  getDb,
  ensureCollection,
  allDocs,
  countDocs,
  findByField,
  getDoc,
  setDoc,
  updateDoc,
  removeDoc,
  useLocal,
  resolveCloudUrls,
  applyCloudUrls,
  resetLocal: localDb.resetLocal
}
