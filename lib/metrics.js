const promClient = require('prom-client')

async function setupMetricsEndpoint (
  instrumentedSwarm,
  { server }
) {
  promClient.collectDefaultMetrics()

  server.get('/metrics', async function (req, reply) {
    const promMetrics = await promClient.register.metrics()
    const swarmMetrics = instrumentedSwarm.getPrometheusMetrics()
    reply.send(promMetrics + swarmMetrics)
  })
}

module.exports = setupMetricsEndpoint
