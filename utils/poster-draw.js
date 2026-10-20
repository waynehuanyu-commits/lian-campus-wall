const sharePoster = require('./share-poster')

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function loadImage(canvas, src) {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error('empty image'))
      return
    }
    const img = canvas.createImage()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

function drawCover(ctx, img, x, y, w, h) {
  // 完整等比放入区域，不裁剪；上下/左右留白
  const iw = img.width || 1
  const ih = img.height || 1
  const scale = Math.min(w / iw, h / ih)
  const dw = iw * scale
  const dh = ih * scale
  const dx = x + (w - dw) / 2
  const dy = y + (h - dh) / 2
  ctx.drawImage(img, dx, dy, dw, dh)
  return { height: dh + (h - dh) }
}

function drawBrandMark(ctx, x, y, size) {
  ctx.save()
  ctx.translate(x, y)
  ctx.strokeStyle = '#2F6FE0'
  ctx.lineWidth = 7
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(size * 0.34, size * 0.5, size * 0.22, Math.PI * 0.65, Math.PI * 1.75)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(size * 0.66, size * 0.5, size * 0.22, Math.PI * 0.65, Math.PI * 1.75)
  ctx.stroke()
  ctx.restore()
}

function drawPerson(ctx, x, y, size) {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = '#C5CEDA'
  ctx.beginPath()
  ctx.arc(size / 2, size * 0.38, size * 0.16, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(size / 2, size * 0.92, size * 0.28, Math.PI, 0)
  ctx.fill()
  ctx.restore()
}

async function drawSharePoster(canvas, payload) {
  const width = sharePoster.POSTER_WIDTH
  const dpr = 2
  const post = payload.publicPost || {}
  const codePath = payload.codeLocalPath || ''
  const firstImagePath = payload.firstImageLocalPath || ''
  const avatarPath = payload.avatarLocalPath || ''
  const anonymous = !!post.anonymous

  const pad = 48
  const contentW = width - pad * 2

  canvas.width = width * dpr
  canvas.height = 2400 * dpr
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  ctx.font = '500 30px sans-serif'
  const bodyLimit = firstImagePath ? 2 : 4
  const bodyWrap = sharePoster.wrapLines(ctx, post.content || '', contentW, bodyLimit, '展开')
  const bodyLineH = 46
  ctx.font = '700 52px sans-serif'
  const titleWrap = post.title ? sharePoster.wrapLines(ctx, post.title, contentW, 2) : { lines: [] }
  const titleLineH = 64

  let firstImg = null
  let firstBlockH = 0
  const imageMax = 460
  if (firstImagePath) {
    firstImg = await loadImage(canvas, firstImagePath)
    const iw = firstImg.width || 1
    const ih = firstImg.height || 1
    const scale = Math.min(contentW / iw, imageMax / ih, 1)
    firstBlockH = Math.max(160, Math.round(ih * scale))
  }

  let codeImg = null
  if (codePath) {
    try {
      codeImg = await loadImage(canvas, codePath)
    } catch (err) {
      codeImg = null
    }
  }

  const headerH = 88
  const titleH = titleWrap.lines.length * titleLineH
  const bodyH = bodyWrap.lines.length * bodyLineH
  const authorH = anonymous ? 88 : 108
  const codeSize = 240
  const footerH = codeSize + 36
  const height = Math.ceil(
    36 + headerH + 28 + titleH + 16 + bodyH + 28
    + (firstBlockH ? firstBlockH + 36 : 0)
    + authorH + 28 + footerH + 40
  )

  canvas.width = width * dpr
  canvas.height = height * dpr
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.scale(dpr, dpr)

  ctx.fillStyle = '#F6F1E8'
  ctx.fillRect(0, 0, width, height)

  let y = 40
  drawBrandMark(ctx, pad, y + 8, 56)
  ctx.fillStyle = '#1A3E78'
  ctx.font = '700 34px sans-serif'
  ctx.fillText('黎安话事', pad + 72, y + 46)

  if (post.category) {
    ctx.font = '600 24px sans-serif'
    const label = post.category
    const tw = ctx.measureText(label).width + 36
    const pillX = width - pad - tw
    ctx.fillStyle = '#E5F0FF'
    roundRect(ctx, pillX, y + 10, tw, 48, 24)
    ctx.fill()
    ctx.fillStyle = '#3B78D6'
    ctx.fillText(label, pillX + 18, y + 42)
  }
  y += headerH + 20

  ctx.fillStyle = '#1A3E78'
  ctx.font = '700 52px sans-serif'
  titleWrap.lines.forEach((line) => {
    ctx.fillText(line, pad, y + 48)
    y += titleLineH
  })
  y += 12

  ctx.font = '500 30px sans-serif'
  bodyWrap.lines.forEach((line, index) => {
    const showExpand = bodyWrap.overflow && bodyWrap.expand && index === bodyWrap.lines.length - 1
    ctx.fillStyle = '#1A3E78'
    ctx.fillText(line, pad, y + 32)
    if (showExpand) {
      ctx.fillStyle = '#8A97AB'
      ctx.fillText(bodyWrap.expand, pad + ctx.measureText(line).width, y + 32)
    }
    y += bodyLineH
  })
  y += 20

  if (firstImg) {
    const box = firstBlockH
    ctx.save()
    roundRect(ctx, pad, y, contentW, box, 8)
    ctx.clip()
    ctx.fillStyle = '#F6F1E8'
    ctx.fillRect(pad, y, contentW, box)
    drawCover(ctx, firstImg, pad, y, contentW, box)
    ctx.restore()
    y += box + 36
  }

  const avatarSize = 72
  ctx.save()
  ctx.beginPath()
  ctx.arc(pad + avatarSize / 2, y + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2)
  ctx.closePath()
  ctx.fillStyle = anonymous ? '#EEF1F5' : '#F3D5DC'
  ctx.fill()
  ctx.clip()
  if (avatarPath) {
    try {
      const avatar = await loadImage(canvas, avatarPath)
      ctx.drawImage(avatar, pad, y, avatarSize, avatarSize)
    } catch (err) {
      drawPerson(ctx, pad, y, avatarSize)
    }
  } else {
    drawPerson(ctx, pad, y, avatarSize)
  }
  ctx.restore()

  const nameX = pad + avatarSize + 20
  ctx.fillStyle = '#1A3E78'
  ctx.font = '600 30px sans-serif'
  const name = post.authorName || (anonymous ? '匿名同学' : '同学')
  ctx.fillText(name, nameX, y + (anonymous ? 46 : 34))
  if (!anonymous && post.authorSchool) {
    const nameW = ctx.measureText(name).width
    ctx.font = '500 22px sans-serif'
    const school = post.authorSchool
    const sw = ctx.measureText(school).width + 24
    const sx = nameX + nameW + 16
    ctx.fillStyle = '#E7EEF8'
    roundRect(ctx, sx, y + 8, sw, 36, 18)
    ctx.fill()
    ctx.fillStyle = '#5C7194'
    ctx.fillText(school, sx + 12, y + 33)
  }
  if (!anonymous && post.createdText) {
    ctx.fillStyle = '#8A97AB'
    ctx.font = '400 24px sans-serif'
    ctx.fillText(post.createdText, nameX, y + 72)
  }
  y += authorH + 8

  ctx.strokeStyle = '#E4DDD2'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(pad, y)
  ctx.lineTo(width - pad, y)
  ctx.stroke()
  y += 36

  const codeX = width - pad - codeSize
  if (codeImg) {
    ctx.save()
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(codeImg, codeX, y, codeSize, codeSize)
    ctx.restore()
  } else {
    ctx.fillStyle = '#FBF8F3'
    roundRect(ctx, codeX, y, codeSize, codeSize, 12)
    ctx.fill()
    ctx.strokeStyle = '#E4DDD2'
    ctx.strokeRect(codeX + 1, y + 1, codeSize - 2, codeSize - 2)
    ctx.fillStyle = '#8A97AB'
    ctx.font = '500 22px sans-serif'
    const hint = '原帖码待补'
    const hw = ctx.measureText(hint).width
    ctx.fillText(hint, codeX + (codeSize - hw) / 2, y + codeSize / 2 + 8)
  }
  ctx.fillStyle = '#1A3E78'
  ctx.font = '700 32px sans-serif'
  ctx.fillText('查看详情并留言', pad, y + 58)
  ctx.fillStyle = '#8A97AB'
  ctx.font = '400 24px sans-serif'
  ctx.fillText(bodyWrap.overflow ? '扫码展开全文' : '长按识别，进入原帖', pad, y + 100)

  return { width, height }
}

function canvasToTempFile(canvas) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      fileType: 'png',
      quality: 1,
      success: (res) => resolve(res.tempFilePath),
      fail: (err) => reject(err || new Error('导出失败'))
    })
  })
}

module.exports = {
  drawSharePoster,
  canvasToTempFile
}
