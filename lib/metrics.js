const promClient = require('prom-client')

async function setupMetricsEndpoint (
  instrumentedSwarm,
  { server }
) {
  promClient.collectDefaultMetrics()

  server.get('/metrics', async function (req, reply) {
    const promMetrics = await promClient.register.metrics()
    const swarmMetrics = getSwarmMetrics(instrumentedSwarm)
    reply.send(promMetrics + swarmMetrics)
  })
}

function getSwarmMetrics (instrumentedSwarm) {
  const metricData = instrumentedSwarm.getMetrics()
  const res = `
# HELP nr_swarm_peers Number of peers this swarm is connected to
# TYPE nr_swarm_peers gauge
hyperswarm_nr_swarm_peers ${metricData.get('nrSwarmPeers')}

# HELP nr_swarm_hosts Number of ip addresses the swarm is connected with (multiple ports on the same IP are counted only once)
# TYPE nr_swarm_hosts gauge
hyperswarm__nr_swarm_hosts ${metricData.get('nrSwarmHosts')}

# HELP nr_dht_peers Number of peers the dht is connected with
# TYPE nr_dht_peers gauge
hyperswarm_nr_dht_peers ${metricData.get('nrDhtPeers')}

# HELP nr_dht_hosts Number of ip addresses the dht is connected with (multiple ports on the same IP are counted only once)
# TYPE nr_dht_hosts gauge
hyperswarm_nr_dht_hosts ${metricData.get('nrDhtHosts')}

# HELP swarm_connections_opened Total number of connection opened by the swarm
# TYPE swarm_connections_opened counter
hyperswarm_swarm_connections_opened ${metricData.get('swarmConnectionsOpened')}

# HELP swarm_connections_closed Total number of connection closed by the swarm
# TYPE swarm_connections_closed counter
hyperswarm_swarm_connections_closed ${metricData.get('swarmConnectionsClosed')}
`

  return res
}

module.exports = setupMetricsEndpoint
