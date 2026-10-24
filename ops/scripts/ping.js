const { ping } = require('../lib/db')

ping()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.ok ? 0 : 1)
  })
  .catch((err) => {
    console.error(err.message || err)
    process.exit(1)
  })
