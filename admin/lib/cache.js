const store = new Map()

function get(key) {
  const hit = store.get(key)
  if (!hit) return null
  if (Date.now() > hit.expireAt) {
    store.delete(key)
    return null
  }
  return hit.value
}

function set(key, value, ttlMs = 30000) {
  store.set(key, { value, expireAt: Date.now() + Math.max(1000, ttlMs) })
  return value
}

function wrap(key, ttlMs, loader) {
  const hit = get(key)
  if (hit != null) return Promise.resolve(hit)
  return Promise.resolve()
    .then(loader)
    .then((value) => set(key, value, ttlMs))
}

function clear(prefix) {
  if (!prefix) {
    store.clear()
    return
  }
  for (const key of store.keys()) {
    if (String(key).startsWith(prefix)) store.delete(key)
  }
}

module.exports = { get, set, wrap, clear }
