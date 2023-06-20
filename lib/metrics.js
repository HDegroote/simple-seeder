const express = require('express')
const promClient = require('prom-client')

async function setupMetricsServer (
  { host = '127.0.0.1', port = undefined }
) {
  promClient.collectDefaultMetrics()
  const app = express()

  app.get('/metrics', async function (req, res, next) {
    try {
      res.set('Content-Type', promClient.register.contentType)
      res.end(await promClient.register.metrics())
    } catch (e) {
      next(e)
    }
  })

  const listener = app.listen(port, host)
  const readyProm = new Promise((resolve) => {
    listener.on(
      'listening',
      () => {
        const address = listener.address()
        console.log(`Metrics server listening on ${address.address} on port ${address.port}`)
        resolve()
      }
    )
  })

  await readyProm
  return listener
}

module.exports = setupMetricsServer
