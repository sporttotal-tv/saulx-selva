const { start } = require('@sporttotal/selva-server')
const getPort = require('get-port')

;(async () => {
  // const pid = process.pid
  const port = await getPort()
  await start({ port })
  // console.info(JSON.stringify({ pid, port }))
})()
