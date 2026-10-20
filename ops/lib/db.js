const cloudbase = require('@cloudbase/node-sdk')
const { requireTcbConfig } = require('./env')

let app = null

function getApp() {
  if (app) return app
  const { env, secretId, secretKey } = requireTcbConfig()
  app = cloudbase.init({
    env,
    secretId,
    secretKey
  })
  return app
}

function getDb() {
  return getApp().database()
}

async function countCollection(name) {
  const db = getDb()
  try {
    const res = await db.collection(name).count()
    if (res && typeof res.total === 'number') return res.total
    if (res && res.data && typeof res.data.total === 'number') return res.data.total
  } catch (err) {
    return { error: (err && err.message) || String(err) }
  }
  return 0
}

async function ping() {
  const { env } = requireTcbConfig()
  const db = getDb()
  const users = await countCollection('users')
  return {
    ok: true,
    env,
    users: typeof users === 'number' ? users : null,
    usersError: typeof users === 'object' ? users.error : null
  }
}

module.exports = {
  getApp,
  getDb,
  countCollection,
  ping
}
