const fs = require('fs')
const path = require('path')
const { countCollection } = require('../lib/db')

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../cloud/collections.json'), 'utf8')
)
const names = manifest.collections || []

async function main() {
  const rows = []
  for (const name of names) {
    const total = await countCollection(name)
    if (typeof total === 'number') {
      rows.push({ collection: name, count: total })
    } else {
      rows.push({ collection: name, error: total.error })
    }
  }
  console.log(JSON.stringify({ collections: rows }, null, 2))
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
