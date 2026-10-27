// 发帖防重：同一份草稿（含超时后重试）沿用同一个 submitId，服务端按它只存一条；内容改了才换新的
function makeSubmitId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

function submitIdFor(page, draft) {
  const sig = JSON.stringify(draft)
  if (!page._submitDraft || page._submitDraft.sig !== sig) {
    page._submitDraft = { sig, id: makeSubmitId() }
  }
  return page._submitDraft.id
}

// 图片上传、网络超时等抛错统一变成失败结果，页面据此解锁并保留草稿
function networkFailure(detail) {
  return { ok: false, code: 'NETWORK', message: `发布没有完成，草稿已保留，请重试${detail ? `（${detail}）` : ''}` }
}

async function runPublish(task) {
  try {
    const result = await task()
    if (!result) return networkFailure('')
    if (result.code === 'NETWORK') return networkFailure(result.message)
    return result
  } catch (err) {
    return networkFailure((err && (err.errMsg || err.message)) || '')
  }
}

module.exports = {
  submitIdFor,
  runPublish
}
