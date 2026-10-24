const fs = require('fs')
const path = require('path')

function loadEnv() {
  const file = path.join(__dirname, '.env')
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

module.exports = { loadEnv }
