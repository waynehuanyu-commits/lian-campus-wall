/**
 * 图片展示只走本地临时文件。
 * <image> 直接绑 cloud:// 或 tcb.qcloud.la 时，渲染层会打出 HTTP 451，灰块。
 * 这里用 wx.cloud.downloadFile 落到 wxfile://，再给 src。
 */
const config = require('./config')

const localCache = new Map()
const MAX_PARALLEL = 4

function asList(urls, current) {
  const list = (Array.isArray(urls) ? urls : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
  const cur = String(current || '').trim()
  if (cur && !list.includes(cur)) list.unshift(cur)
  return list
}

function isCloudId(value) {
  return /^cloud:\/\//.test(String(value || ''))
}

function isTcbHttps(value) {
  return /^https?:\/\/[a-z0-9-]+\.tcb\.qcloud\.la\//i.test(String(value || ''))
}

function isLocalPath(value) {
  const raw = String(value || '')
  return raw.startsWith('wxfile://')
    || raw.startsWith('http://tmp')
    || raw.startsWith('https://tmp')
    || raw.startsWith('/images/')
    || raw.startsWith('data:')
}

function isMediaFieldKey(key) {
  return key === 'images'
    || key === 'studentAuthImages'
    || /avatar|Avatar|image|Image|cover|photo|thumb/i.test(String(key || ''))
}

function toCloudId(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (isCloudId(raw)) return raw.split('?')[0]
  const match = raw.match(/^https?:\/\/([a-z0-9-]+)\.tcb\.qcloud\.la\/([^?#]+)/i)
  if (!match) return ''
  const bucket = match[1]
  const path = match[2]
  const envMatch = bucket.match(/^6c69-(.+)-\d+$/)
  const env = (envMatch && envMatch[1]) || config.cloudEnvId
  if (!env || !bucket || !path) return ''
  return `cloud://${env}.${bucket}/${path}`
}

function needsLocal(value) {
  const raw = String(value || '').trim()
  if (!raw || isLocalPath(raw)) return false
  if (isCloudId(raw)) return true
  // 已签名的临时链可以直接给 image；没签名的 tcb 直链会 451
  if (isTcbHttps(raw)) return !/[?&]sign=/i.test(raw)
  return false
}

function downloadHttps(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve('')
      return
    }
    wx.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode && res.statusCode !== 200) {
          resolve('')
          return
        }
        resolve((res && res.tempFilePath) || '')
      },
      fail: () => resolve('')
    })
  })
}

function downloadCloudFile(fileID) {
  return new Promise((resolve) => {
    if (!fileID || !wx.cloud || !wx.cloud.downloadFile) {
      resolve('')
      return
    }
    wx.cloud.downloadFile({
      fileID,
      success: (res) => resolve((res && res.tempFilePath) || ''),
      fail: () => resolve('')
    })
  })
}

function tempUrlOf(fileID) {
  return new Promise((resolve) => {
    if (!fileID || !wx.cloud || !wx.cloud.getTempFileURL) {
      resolve('')
      return
    }
    // 小程序端 fileList 只能是 cloud:// 字符串，不能带 maxAge
    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success: (res) => {
        const row = ((res && res.fileList) || [])[0] || {}
        const url = row.tempFileURL || ''
        const ok = url && (row.status === 0 || row.status === '0' || row.status == null)
        resolve(ok ? url : '')
      },
      fail: () => resolve('')
    })
  })
}

async function toLocal(value) {
  const raw = String(value || '').trim()
  if (!needsLocal(raw)) return raw
  const fileID = toCloudId(raw)
  if (!fileID) return raw
  if (localCache.has(fileID)) return localCache.get(fileID) || raw
  // 带签名的临时链可以直接给 <image>，不要再 download（没配下载域名时会失败）
  let local = await tempUrlOf(fileID)
  if (!local) local = await downloadCloudFile(fileID)
  if (local) localCache.set(fileID, local)
  return local || raw
}

async function mapPool(items, worker) {
  const out = new Array(items.length)
  let cursor = 0
  async function run() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      out[index] = await worker(items[index], index)
    }
  }
  const n = Math.min(MAX_PARALLEL, items.length)
  await Promise.all(Array.from({ length: n }, () => run()))
  return out
}

function collectNodes(input, bag) {
  if (!input) return
  if (typeof input === 'string') return
  if (Array.isArray(input)) {
    input.forEach((item, index) => {
      if (typeof item === 'string' && needsLocal(item)) bag.push({ parent: input, key: index })
      else collectNodes(item, bag)
    })
    return
  }
  if (typeof input === 'object') {
    Object.keys(input).forEach((key) => {
      const value = input[key]
      if (typeof value === 'string' && isMediaFieldKey(key) && needsLocal(value)) {
        bag.push({ parent: input, key })
      } else if (isMediaFieldKey(key) || (value && typeof value === 'object')) {
        collectNodes(value, bag)
      }
    })
  }
}

async function hydrate(payload) {
  if (!payload || !config.useCloud) return payload
  const bag = []
  collectNodes(payload, bag)
  if (!bag.length) return payload
  await mapPool(bag, async (node) => {
    const local = await toLocal(node.parent[node.key])
    if (local) node.parent[node.key] = local
  })
  return payload
}

async function resolveUrls(urls = []) {
  const list = (Array.isArray(urls) ? urls : []).map((item) => String(item || '').trim()).filter(Boolean)
  return mapPool(list, (item) => toLocal(item))
}

async function previewImages(current, urls = []) {
  const list = asList(urls, current)
  if (!list.length) return
  const resolved = (await resolveUrls(list)).filter(Boolean)
  if (!resolved.length) {
    wx.showToast({ title: '图片暂时无法打开', icon: 'none' })
    return
  }
  const idx = list.indexOf(String(current || '').trim())
  const cur = idx >= 0 && resolved[idx] ? resolved[idx] : resolved[0]
  wx.previewImage({ current: cur, urls: resolved })
}

// 大图上传前温和压缩：只处理超过 300KB 的，长边限 1600、质量 85，手机上看不出差别；任何一步失败都用原图
const SHRINK_OVER_BYTES = 300 * 1024
const SHRINK_LONG_EDGE = 1600

function shrinkIfLarge(file) {
  const src = file && file.tempFilePath
  return new Promise((resolve) => {
    if (!src || !(Number(file.size) > SHRINK_OVER_BYTES) || typeof wx.compressImage !== 'function') {
      resolve(src)
      return
    }
    const compress = (info) => {
      const opts = {
        src,
        quality: 85,
        success: (res) => resolve((res && res.tempFilePath) || src),
        fail: () => resolve(src)
      }
      if (info && info.width >= info.height && info.width > SHRINK_LONG_EDGE) opts.compressedWidth = SHRINK_LONG_EDGE
      else if (info && info.height > info.width && info.height > SHRINK_LONG_EDGE) opts.compressedHeight = SHRINK_LONG_EDGE
      wx.compressImage(opts)
    }
    if (typeof wx.getImageInfo !== 'function') {
      compress(null)
      return
    }
    wx.getImageInfo({ src, success: compress, fail: () => compress(null) })
  })
}

function chooseImages({ count = 9, existing = [] } = {}) {
  const remain = Math.max(0, Number(count) || 0)
  const base = Array.isArray(existing) ? existing.slice() : []
  if (remain <= 0) return Promise.resolve(base)
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        Promise.all((res.tempFiles || []).map(shrinkIfLarge)).then((list) => {
          const paths = list.filter(Boolean)
          resolve(base.concat(paths).slice(0, base.length + remain))
        })
      },
      fail: (err) => {
        const msg = String((err && err.errMsg) || '')
        if (/cancel/i.test(msg)) {
          resolve(base)
          return
        }
        reject(err || new Error('选图失败'))
      }
    })
  })
}

module.exports = {
  previewImages,
  chooseImages,
  hydrate,
  resolveUrls,
  toLocal,
  toCloudId,
  isCloudId
}
