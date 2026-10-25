// 小程序「我的」页 / 个人主页顶部照片：读写 meta/mine_cover，小程序云函数 getMineCover 读同一条
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const db = require('./db')

const DOC_ID = 'mine_cover'
const CREDIT_MAX = 30
const UPLOAD_MAX_BYTES = 2 * 1024 * 1024
const UPLOAD_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const LOCAL_UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads')
const LOCAL_PREFIX = '/uploads/'

function isValidSrc(src) {
  if (/^(cloud:\/\/|https:\/\/)/.test(src)) return true
  // 本地演示上传的图只在后台预览用，小程序读不到
  return db.useLocal() && src.startsWith(LOCAL_PREFIX)
}

async function previewUrl(src) {
  if (!/^cloud:\/\//.test(src)) return src
  const map = await db.resolveCloudUrls([src])
  return map[src] || ''
}

async function getCover() {
  const row = await db.getDoc('meta', DOC_ID)
  if (!row || !row.src) return { ok: true, cover: null }
  return {
    ok: true,
    cover: {
      src: row.src,
      credit: row.credit || '',
      enabled: row.enabled !== false,
      updatedAt: Number(row.updatedAt) || 0,
      updatedBy: row.updatedBy || '',
      previewUrl: await previewUrl(row.src)
    }
  }
}

async function saveCover(payload = {}, operator = '') {
  const src = String(payload.src || '').trim()
  const credit = String(payload.credit || '').trim()
  if (!src) return { ok: false, message: '请先上传图片或填写图片地址' }
  if (!isValidSrc(src)) return { ok: false, message: '图片地址只能是云存储 fileID（cloud://）或 https 链接' }
  if (credit.length > CREDIT_MAX) return { ok: false, message: `署名最多 ${CREDIT_MAX} 个字` }
  await db.setDoc('meta', DOC_ID, {
    src,
    credit,
    enabled: payload.enabled !== false,
    updatedAt: Date.now(),
    updatedBy: operator
  })
  return getCover()
}

// 浏览器传 base64，后台转存：云模式进云存储，本地演示存 admin/data/uploads
async function uploadCover(payload = {}) {
  const type = String(payload.type || '').toLowerCase()
  const ext = UPLOAD_TYPES[type]
  if (!ext) return { ok: false, message: '只支持 JPG / PNG / WebP 图片' }
  const base64 = String(payload.data || '').replace(/^data:[^,]+,/, '')
  const buffer = Buffer.from(base64, 'base64')
  if (!buffer.length) return { ok: false, message: '图片内容为空' }
  if (buffer.length > UPLOAD_MAX_BYTES) return { ok: false, message: '图片不能超过 2MB，请先压缩' }
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`
  if (db.useLocal()) {
    fs.mkdirSync(LOCAL_UPLOAD_DIR, { recursive: true })
    fs.writeFileSync(path.join(LOCAL_UPLOAD_DIR, name), buffer)
    const src = `${LOCAL_PREFIX}${name}`
    return { ok: true, src, previewUrl: src }
  }
  const src = await db.uploadFile(`covers/${name}`, buffer)
  return { ok: true, src, previewUrl: await previewUrl(src) }
}

// 本地演示模式下给后台预览上传的图
function serveLocalUpload(req, res) {
  const name = path.basename(req.url.split('?')[0])
  const file = path.join(LOCAL_UPLOAD_DIR, name)
  if (!db.useLocal() || !fs.existsSync(file)) {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  const ext = path.extname(name).slice(1)
  const mime = Object.keys(UPLOAD_TYPES).find((key) => UPLOAD_TYPES[key] === ext) || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' })
  fs.createReadStream(file).pipe(res)
}

module.exports = {
  CREDIT_MAX,
  LOCAL_PREFIX,
  getCover,
  saveCover,
  uploadCover,
  serveLocalUpload
}
