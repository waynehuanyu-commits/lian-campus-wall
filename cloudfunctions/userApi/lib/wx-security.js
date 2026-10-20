/**
 * 微信内容安全（云调用）
 * - 文本：security.msgSecCheck v2（时政/色情/违法/广告等）
 * - 图片：security.imgSecCheck（同步）
 *
 * 需：
 * 1. 云函数 config.json 声明 openapi 权限
 * 2. 重新上传部署 userApi
 * 3. 用户近两小时访问过小程序（openid 有效）
 */

const cloud = require('wx-server-sdk')

const LABEL_TEXT = {
  100: '正常',
  10001: '疑似广告引流',
  20001: '疑涉时政敏感内容',
  20002: '疑涉色情内容',
  20003: '疑涉辱骂攻击',
  20006: '疑涉违法犯罪',
  20008: '疑涉欺诈',
  20012: '疑涉低俗内容',
  20013: '疑涉版权问题',
  21000: '未通过内容安全审核'
}

const TEXT_CHUNK = 2400
const TEXT_TIMEOUT_MS = 8000
const IMAGE_TIMEOUT_MS = 8000
const MAX_IMAGES = 3

function sceneFor(contentType) {
  // 1 资料；2 评论；3 论坛；4 社交日志
  if (contentType === 'nickname' || contentType === 'bio' || contentType === 'profile') return 1
  if (contentType === 'comment' || contentType === 'dm') return 2
  if (contentType === 'forum' || contentType === 'wall') return 3
  return 4
}

function buildCheckText(input = {}) {
  return [
    input.title,
    input.content,
    input.extra,
    input.routeFrom,
    input.routeTo,
    input.departTime,
    input.nickname,
    input.bio,
    input.signature,
    input.contactValue
  ].filter(Boolean).join('\n').trim()
}

function chunkText(text, max = TEXT_CHUNK) {
  const chars = Array.from(String(text || ''))
  if (!chars.length) return []
  const chunks = []
  for (let i = 0; i < chars.length; i += max) {
    chunks.push(chars.slice(i, i + max).join(''))
  }
  return chunks
}

function errCodeOf(payload) {
  if (!payload || typeof payload !== 'object') return 0
  return Number(payload.errCode || payload.errcode || 0)
}

function withTimeout(promise, ms, code = 'TIMEOUT') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const err = new Error(`${code}`)
      err.code = code
      setTimeout(() => reject(err), ms)
    })
  ])
}

function labelMessage(label, fallback = '未通过云端安全审核') {
  const key = Number(label || 0)
  if (!key || key === 100) return fallback
  return LABEL_TEXT[key] || fallback
}

function collectHits(result) {
  const hits = []
  const main = result && result.result
  if (main && typeof main === 'object') hits.push(main)
  const details = (result && Array.isArray(result.detail)) ? result.detail : []
  details.forEach((item) => {
    if (!item || typeof item !== 'object') return
    // detail 项 errcode 为 0 时该项有效
    const code = errCodeOf(item)
    if (code === 0 || item.suggest) hits.push(item)
  })
  return hits
}

function decideFromHits(hits, fallbackMessage) {
  let worst = { level: 0, suggest: 'pass', label: 100, keyword: '', message: '' }
  const rank = { pass: 0, review: 1, risky: 2 }

  hits.forEach((hit) => {
    const suggest = String(hit.suggest || 'pass').toLowerCase()
    const label = Number(hit.label || 100)
    const level = rank[suggest] != null ? rank[suggest] : 0
    if (level < worst.level) return
    if (level === worst.level && label !== 20001 && worst.label === 20001) return
    worst = {
      level,
      suggest,
      label,
      keyword: hit.keyword || '',
      message: labelMessage(label, fallbackMessage),
      prob: hit.prob
    }
  })

  if (worst.suggest === 'risky') {
    return {
      highRisk: true,
      message: worst.message,
      label: worst.label,
      suggest: 'risky',
      keyword: worst.keyword,
      source: 'msgSecCheck'
    }
  }
  if (worst.suggest === 'review') {
    return {
      uncertain: true,
      message: worst.message || '云端审核不确定，已转人工',
      label: worst.label,
      suggest: 'review',
      keyword: worst.keyword,
      source: 'msgSecCheck'
    }
  }
  return {
    ok: true,
    label: worst.label || 100,
    suggest: 'pass',
    source: 'msgSecCheck'
  }
}

function asVendorError(err, source) {
  const code = errCodeOf(err)
  if (code === 87014) {
    return {
      highRisk: true,
      message: '未通过云端安全审核',
      label: 21000,
      suggest: 'risky',
      source,
      errCode: code
    }
  }
  if (err && (err.code === 'TIMEOUT' || /timeout/i.test(String(err.message || '')))) {
    return { timeout: true, source, errCode: code || undefined }
  }
  return {
    skipped: true,
    reason: (err && (err.errMsg || err.message || err.code)) || 'openapi_unavailable',
    source,
    errCode: code || undefined
  }
}

async function msgSecCheckOnce(params) {
  const result = await withTimeout(
    cloud.openapi.security.msgSecCheck(params),
    TEXT_TIMEOUT_MS
  )
  const topCode = errCodeOf(result)
  if (topCode === 87014) {
    const hits = collectHits(result)
    const decided = decideFromHits(hits, '未通过云端安全审核')
    return { ...decided, highRisk: true, suggest: decided.suggest || 'risky', errCode: 87014 }
  }
  if (topCode && topCode !== 0) {
    // 40001/40003/40125 等配置问题：跳过，不误伤发帖
    return {
      skipped: true,
      reason: `errcode_${topCode}`,
      source: 'msgSecCheck',
      errCode: topCode
    }
  }
  return decideFromHits(collectHits(result), '未通过云端安全审核')
}

/**
 * 文本安全检测（支持长文分段、标题/昵称附加字段）
 */
async function checkText({
  content,
  openid,
  scene = 2,
  title = '',
  nickname = '',
  signature = ''
} = {}) {
  const text = String(content || '').trim()
  if (!text && !String(title || '').trim() && !String(signature || '').trim()) {
    return { skipped: true, reason: 'empty', source: 'msgSecCheck' }
  }
  if (!isWxOpenid(openid)) {
    return { skipped: true, reason: 'no_openid', source: 'msgSecCheck' }
  }

  const chunks = chunkText(text || title || signature || ' ')
  let worst = { ok: true, suggest: 'pass', source: 'msgSecCheck' }

  for (let i = 0; i < chunks.length; i += 1) {
    const payload = {
      version: 2,
      scene: Number(scene) || 2,
      openid: String(openid),
      content: chunks[i]
    }
    if (title) payload.title = String(title).slice(0, 500)
    if (nickname) payload.nickname = String(nickname).slice(0, 100)
    if (Number(scene) === 1 && signature) {
      payload.signature = String(signature).slice(0, 500)
    }

    let decided
    try {
      decided = await msgSecCheckOnce(payload)
    } catch (err) {
      decided = asVendorError(err, 'msgSecCheck')
    }

    if (decided.highRisk) return decided
    if (decided.timeout) return decided
    if (decided.uncertain) worst = decided
    else if (decided.skipped && worst.ok) worst = decided
  }

  return worst
}

function guessImageContentType(fileID = '') {
  const lower = String(fileID).toLowerCase()
  if (lower.includes('.png')) return 'image/png'
  if (lower.includes('.gif')) return 'image/gif'
  if (lower.includes('.webp')) return 'image/webp'
  if (lower.includes('.bmp')) return 'image/bmp'
  return 'image/jpeg'
}

async function imgSecCheckBuffer(buffer, contentType) {
  return withTimeout(
    cloud.openapi.security.imgSecCheck({
      media: {
        contentType: contentType || 'image/jpeg',
        value: buffer
      }
    }),
    IMAGE_TIMEOUT_MS
  )
}

/**
 * 图片安全检测（云文件 fileID）
 */
async function checkImages(images = [], { openid } = {}) {
  const list = (Array.isArray(images) ? images : []).filter(Boolean).slice(0, MAX_IMAGES)
  if (!list.length) return { skipped: true, reason: 'no_images', source: 'imgSecCheck' }
  if (!isWxOpenid(openid)) return { skipped: true, reason: 'no_openid', source: 'imgSecCheck' }

  // 多图并发送检：串行时每张都要叠加下载与检测耗时
  const outcomes = await Promise.all(list.map(async (fileID) => {
    // 非云文件（本地演示路径）跳过
    if (!/^cloud:\/\//.test(String(fileID))) return null
    try {
      const downloaded = await cloud.downloadFile({ fileID })
      const buffer = downloaded && downloaded.fileContent
      if (!buffer || !buffer.length) {
        return { skipped: true, reason: 'empty_image', source: 'imgSecCheck' }
      }
      // 过大图跳过同步检测，避免拖垮云函数
      if (buffer.length > 1.2 * 1024 * 1024) {
        return { skipped: true, reason: 'image_too_large', source: 'imgSecCheck' }
      }

      const result = await imgSecCheckBuffer(buffer, guessImageContentType(fileID))
      const code = errCodeOf(result)
      if (code === 87014) {
        return {
          highRisk: true,
          message: '图片未通过安全审核',
          label: 21000,
          suggest: 'risky',
          source: 'imgSecCheck',
          fileID
        }
      }
      if (code && code !== 0) {
        return {
          skipped: true,
          reason: `errcode_${code}`,
          source: 'imgSecCheck',
          errCode: code
        }
      }
      return { ok: true, checked: 1, source: 'imgSecCheck' }
    } catch (err) {
      const mapped = asVendorError(err, 'imgSecCheck')
      if (mapped.highRisk) {
        return { ...mapped, message: '图片未通过安全审核', fileID }
      }
      if (!mapped.timeout) {
        console.error('[imgSecCheck]', fileID, mapped.reason || err)
      }
      return mapped
    }
  }))

  const results = outcomes.filter(Boolean)
  const risky = results.find((item) => item.highRisk)
  if (risky) return risky
  const timedOut = results.find((item) => item.timeout)
  if (timedOut) return timedOut
  const checked = results.filter((item) => item.ok).length
  if (checked > 0) {
    return { ok: true, checked, source: 'imgSecCheck', openid: openid || '' }
  }
  const lastSkip = results.length ? results[results.length - 1] : null
  return lastSkip || { skipped: true, reason: 'no_cloud_images', source: 'imgSecCheck' }
}

function isWxOpenid(openid) {
  const id = String(openid || '').trim()
  if (!id) return false
  if (id === 'guest_readonly') return false
  if (id.startsWith('web_') || id.startsWith('guest_')) return false
  return true
}

// 内容本身无需送检，不算云审核失效
const BENIGN_SKIP_REASONS = ['empty', 'no_cloud_images', 'empty_image', 'no_images']

function isDegradedSkip(item) {
  if (!item || !item.skipped) return false
  return !BENIGN_SKIP_REASONS.includes(String(item.reason || ''))
}

function mergeVendorResults(list) {
  const items = (list || []).filter(Boolean)
  if (!items.length) return { skipped: true, reason: 'empty_vendor' }

  const risky = items.find((item) => item.highRisk)
  if (risky) {
    return {
      ...risky,
      parts: items
    }
  }
  const timeout = items.find((item) => item.timeout)
  if (timeout) {
    return {
      ...timeout,
      parts: items
    }
  }
  const uncertain = items.find((item) => item.uncertain)
  if (uncertain) {
    return {
      ...uncertain,
      parts: items
    }
  }
  const passed = items.find((item) => item.ok)
  if (passed) {
    const imageMiss = items.find((item) => (
      String(item.source || '').includes('imgSecCheck')
      && !item.ok
      && !item.highRisk
      && !BENIGN_SKIP_REASONS.includes(String(item.reason || ''))
    ))
    if (imageMiss) {
      return {
        skipped: true,
        degraded: true,
        timeout: !!imageMiss.timeout,
        reason: imageMiss.reason || 'image_unchecked',
        source: 'imgSecCheck',
        parts: items
      }
    }
    return {
      ok: true,
      suggest: 'pass',
      source: 'combined',
      parts: items
    }
  }
  // 全部 skipped：区分「无需送检」与「接口失效」，后者不得默认放行
  return {
    skipped: true,
    degraded: items.some(isDegradedSkip),
    reason: items.map((item) => item.reason).filter(Boolean).join('|') || 'all_skipped',
    source: 'combined',
    parts: items
  }
}

/**
 * 统一入口：文本 + 图片
 */
async function checkAll({ input = {}, openid = '', nickname = '' } = {}) {
  const scene = sceneFor(input.contentType)
  const content = buildCheckText(input)
  const title = String(input.title || '').trim()
  const signature = String(input.signature || input.bio || '').trim()

  // 文本与图片检测互不依赖，并发跑，否则发布要串起两段网络等待
  const [textVendor, imageVendor] = await Promise.all([
    checkText({
      content: content || title || signature,
      openid,
      scene,
      title,
      nickname: nickname || input.nickname || '',
      signature: scene === 1 ? (signature || content) : ''
    }),
    checkImages(input.images || [], { openid })
  ])
  const merged = mergeVendorResults([textVendor, imageVendor])

  if (merged.skipped || merged.timeout) {
    console.warn('[content-security]', JSON.stringify({
      scene,
      openid: openid ? `${String(openid).slice(0, 6)}***` : '',
      text: textVendor,
      image: imageVendor,
      merged: {
        skipped: merged.skipped,
        degraded: merged.degraded,
        timeout: merged.timeout,
        reason: merged.reason
      }
    }))
  } else if (merged.highRisk || merged.uncertain) {
    console.warn('[content-security-hit]', JSON.stringify({
      scene,
      suggest: merged.suggest,
      label: merged.label,
      message: merged.message,
      source: merged.source
    }))
  }

  return merged
}

module.exports = {
  LABEL_TEXT,
  sceneFor,
  buildCheckText,
  chunkText,
  checkText,
  checkImages,
  checkAll,
  msgSecCheck: checkText
}
