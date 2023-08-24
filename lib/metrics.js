const promClient = require('prom-client')

async function setupMetricsEndpoint (
  instrumentedSwarm,
  { server }
) {
  promClient.collectDefaultMetrics()
  instrumentedSwarm.registerPrometheusMetrics(promClient)

  server.get('/metrics', async function (req, reply) {
    const promMetrics = await promClient.register.metrics()
    reply.send(promMetrics)
  })
}

module.exports = setupMetricsEndpoint
