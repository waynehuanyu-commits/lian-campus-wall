const fs = require('fs')
const path = require('path')
const { loadEnv: loadServerEnv } = require('../../server/load-env')

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
    const text = line.trim()
    if (!text || text.startsWith('#')) return
    const index = text.indexOf('=')
    if (index < 1) return
    const key = text.slice(0, index).trim()
    const value = text.slice(index + 1).trim()
    if (!process.env[key]) process.env[key] = value
  })
}

/** 运营脚本：server/.env → admin/.env → ops/.env（后者不覆盖已存在的变量） */
function loadOpsEnv() {
  loadServerEnv()
  loadDotEnv(path.join(__dirname, '../../admin/.env'))
  loadDotEnv(path.join(__dirname, '../.env'))
}

function requireTcbConfig() {
  loadOpsEnv()
  const env = process.env.TCB_ENV
  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  if (!env || !secretId || !secretKey) {
    throw new Error(
      '缺少 TCB_ENV / TCB_SECRET_ID / TCB_SECRET_KEY。可复制 ops/.env.example 为 ops/.env，或与 admin/.env 填同一套密钥。'
    )
  }
  if (process.env.ADMIN_LOCAL === '1') {
    throw new Error('ADMIN_LOCAL=1 为本地演示，不能接云库。请去掉 ADMIN_LOCAL 并配置 TCB 三项。')
  }
  return { env, secretId, secretKey }
}

module.exports = {
  loadOpsEnv,
  requireTcbConfig
}
