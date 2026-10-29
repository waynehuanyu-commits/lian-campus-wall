// 争议内容的推送确认：给确认人（WECOM_CONFIRM_USERS，多人用逗号）发企微应用消息，
// 消息里是带签名的链接，手机上点开就能选「推送 / 不推」，不用登录后台。
// 多人谁先点按谁的，后点的人看到「已处理」，同一条只会推一次。
// 链接地址用 PUSH_CONFIRM_BASE（运营后台对外地址），签名密钥 PUSH_CONFIRM_SECRET 只放服务器 .env。

const crypto = require('crypto')
const db = require('./db')

const WECOM_HOST = 'https://qyapi.weixin.qq.com'
const LINK_TTL_MS = 3 * 24 * 3600 * 1000

function secret() {
  return process.env.PUSH_CONFIRM_SECRET || ''
}

function sign(id, exp) {
  return crypto.createHmac('sha256', secret()).update(`${id}.${exp}`).digest('hex').slice(0, 32)
}

function confirmUrl(id) {
  const exp = Date.now() + LINK_TTL_MS
  const base = String(process.env.PUSH_CONFIRM_BASE || '').replace(/\/$/, '')
  return `${base}/push-confirm?id=${encodeURIComponent(id)}&exp=${exp}&sig=${sign(id, exp)}`
}

function verify(id, exp, sig) {
  if (!secret() || !id || !sig) return false
  if (!(Number(exp) > Date.now())) return false
  const expected = sign(id, exp)
  return expected.length === String(sig).length
    && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(sig)))
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/** 发确认消息；返回是否发出。确认人、应用 ID、对外地址任一没配就不发（帖子留在队列等后台处理） */
async function notifyConfirmers(token, item, reasons) {
  const users = String(process.env.WECOM_CONFIRM_USERS || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!users.length || !process.env.WECOM_AGENT_ID || !process.env.PUSH_CONFIRM_BASE || !secret()) {
    return { ok: false, error: '确认人 / 应用 ID / 对外地址 / 签名密钥 没配齐' }
  }
  const res = await fetch(`${WECOM_HOST}/cgi-bin/message/send?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      touser: users.join('|'),
      msgtype: 'textcard',
      agentid: Number(process.env.WECOM_AGENT_ID),
      textcard: {
        title: '有一条帖子待确认是否推送到群',
        description: `<div class="highlight">${escapeHtml(reasons.join('；'))}</div><div>${escapeHtml(item.title)}</div><div class="gray">${escapeHtml(item.summary)}</div>`,
        url: confirmUrl(item.id),
        btntxt: '去确认'
      }
    })
  }).then((r) => r.json())
  return res.errcode ? { ok: false, error: `${res.errcode} ${res.errmsg}` } : { ok: true }
}

function page(title, body) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
body{margin:0;font:16px/1.6 -apple-system,"PingFang SC",sans-serif;background:#f2f5fa;color:#1a2233}
main{max-width:520px;margin:0 auto;padding:24px 18px}
.card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 4px 18px rgba(10,42,122,.06)}
h1{font-size:19px;margin:0 0 10px}.reason{color:#c2410c;font-size:14px;margin-bottom:12px}
.body{white-space:pre-wrap;color:#3a4458;font-size:15px}.row{display:flex;gap:12px;margin-top:20px}
button{flex:1;border:0;border-radius:12px;padding:14px;font-size:16px;font-weight:600}
.yes{background:#0a5cff;color:#fff}.no{background:#eef1f5;color:#3a4458}.done{color:#7a8496;margin-top:16px}
</style></head><body><main><div class="card">${body}</div></main></body></html>`
}

/** GET 显示帖子 + 两个按钮；POST 记录决定。返回 { status, html } */
async function handle(method, query, form) {
  const { id, exp, sig } = query
  if (!verify(id, exp, sig)) return { status: 403, html: page('链接无效', '<h1>链接无效或已过期</h1><p class="done">请到运营后台处理。</p>') }
  const item = await db.getDoc('digest_queue', id)
  if (!item) return { status: 200, html: page('已处理', '<h1>这条已经处理过了</h1><p class="done">可能已推送、被其他同事处理，或帖子已下线。</p>') }
  if (item.confirm === 'approved' || item.confirm === 'rejected') {
    const who = item.confirmedLabel || '其他同事'
    return { status: 200, html: page('已处理', `<h1>${escapeHtml(who)}已处理</h1><p class="done">结果：${item.confirm === 'approved' ? '下一批推送' : '不推送'}。</p>`) }
  }
  if (method === 'POST') {
    const decision = form.decision === 'approve' ? 'approved' : 'rejected'
    await db.setDoc('digest_queue', id, { ...item, confirm: decision, confirmedAt: Date.now(), confirmedLabel: '有同事' })
    return { status: 200, html: page('已记录', `<h1>${decision === 'approved' ? '好的，下一批推送' : '好的，这条不推'}</h1><p class="done">其他同事再点开会看到已处理。</p>`) }
  }
  const action = `/push-confirm?id=${encodeURIComponent(id)}&exp=${encodeURIComponent(exp)}&sig=${encodeURIComponent(sig)}`
  return {
    status: 200,
    html: page('推送确认', `<h1>${escapeHtml(item.title)}</h1>
<div class="reason">需要确认：${escapeHtml((item.confirmReasons || []).join('；'))}</div>
<div class="body">${escapeHtml(item.fullText || item.summary)}</div>
<form method="post" action="${action}" class="row">
<button class="no" name="decision" value="reject">不推</button>
<button class="yes" name="decision" value="approve">推送</button>
</form>`)
  }
}

module.exports = { notifyConfirmers, handle, confirmUrl, verify }
