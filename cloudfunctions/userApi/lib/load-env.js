const fs = require('fs')
const path = require('path')

function applyEnvFile(file) {
  if (!fs.existsSync(file)) return
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
    const text = line.trim()
    if (!text || text.startsWith('#')) return
    const index = text.indexOf('=')
    if (index < 1) return
    const key = text.slice(0, index).trim()
    const value = text.slice(index + 1).trim()
    if (key && !process.env[key]) process.env[key] = value
  })
}

function loadEnv() {
  applyEnvFile(path.join(__dirname, '..', '.env'))
  applyEnvFile(path.join(__dirname, '..', 'wecom.env'))
  try {
    const local = require('../env.local')
    Object.keys(local || {}).forEach((key) => {
      const value = local[key]
      if (key && value && !process.env[key]) process.env[key] = String(value)
    })
  } catch (err) {
    // env.local.js 未上传时走控制台环境变量
  }
}

loadEnv()

module.exports = { loadEnv }
