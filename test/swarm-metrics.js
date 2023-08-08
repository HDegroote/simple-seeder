const test = require('brittle')
const RAM = require('random-access-memory')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const createTestnet = require('hyperdht/testnet')

const InstrumentedSwarm = require('../swarm-metrics')

async function setup (t, testnetSize = 3) {
  const testnet = await createTestnet(testnetSize)
  const swarm1 = new Hyperswarm({ bootstrap: testnet.bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap: testnet.bootstrap })
  const swarm3 = new Hyperswarm({ bootstrap: testnet.bootstrap })

  const store1 = new Corestore(RAM)
  const store2 = new Corestore(RAM)
  const store3 = new Corestore(RAM)

  swarm1.on('connection', (socket) => {
    store1.replicate(socket)
    socket.on('error', e => console.log('ignoring', e))
  })
  swarm2.on('connection', (socket) => {
    store2.replicate(socket)
    socket.on('error', e => console.log('ignoring', e))
  })
  swarm3.on('connection', (socket) => {
    store3.replicate(socket)
    socket.on('error', e => console.log('ignoring', e))
  })

  const core1 = store1.get({ name: 'peer1-core' })
  const core2 = store1.get({ name: 'peer2-core' })

  await Promise.all([core1.ready(), core2.ready()])
  await swarm1.join(core1.discoveryKey)
  await swarm2.join(core2.discoveryKey)
  await Promise.all([swarm1.flush(), swarm2.flush()])

  const core1Read = store3.get({ key: core1.key })
  const core2Read = store3.get({ key: core2.key })
  await Promise.all([core1Read.ready(), core2Read.ready()])
  await swarm3.join(core1Read.discoveryKey)
  await swarm3.join(core2Read.discoveryKey)
  await swarm3.flush()

  await eventFlush()

  t.teardown(async () => {
    await Promise.all([swarm1.destroy(), swarm2.destroy(), swarm3.destroy()])
    await Promise.all([store1.close(), store2.close(), store3.close()])
    await testnet.destroy()
  })

  return [swarm1, swarm2, swarm3]
}

test('instrumented swarm - props', async function (t) {
  const [swarm1, , swarm3] = await setup(t)
  const iSwarm1 = new InstrumentedSwarm(swarm1)
  const iSwarm3 = new InstrumentedSwarm(swarm3)

  t.is(iSwarm1.ownHost, swarm1.dht.host)
  t.is(iSwarm1.ownPort, swarm1.dht.port)
  t.is(iSwarm1.peers, swarm1.peers)
  t.is(iSwarm1.connections, swarm1.connections)
  t.is(iSwarm1.dhtNodes.size, swarm1.dht.nodes.toArray().length)
  t.is([...iSwarm1.dhtNodes.values()][0].host, '127.0.0.1', 'sanity check that the values have correct structure')

  const peerInfos1 = iSwarm1.peerInfos
  t.is(peerInfos1.size, 1, 'sanity check')
  const pInfo1 = peerInfos1.get(iSwarm3.publicKey)

  const peerInfos3 = iSwarm3.peerInfos
  t.is(peerInfos3.size, 2, 'sanity check')
  const pInfo3 = peerInfos3.get(iSwarm1.publicKey)

  t.is(pInfo1.pubKey, iSwarm3.ownKey)
  t.is(pInfo1.ownPort, pInfo3.remotePort)
  t.is(pInfo1.remotePort, pInfo3.ownPort)
})

test('instrumented swarm - metrics', async function (t) {
  const testnetSize = 5
  const [swarm1, swarm2, swarm3] = await setup(t, testnetSize)
  const iSwarm1 = new InstrumentedSwarm(swarm1)
  const iSwarm2 = new InstrumentedSwarm(swarm2)
  const iSwarm3 = new InstrumentedSwarm(swarm3)

  const metrics1 = Object.fromEntries(iSwarm1.getMetrics())
  const metrics2 = Object.fromEntries(iSwarm2.getMetrics())
  const metrics3 = Object.fromEntries(iSwarm3.getMetrics())

  t.is(metrics1.nrSwarmPeers, 1, 'Peer 1 -> peer 3')
  t.is(metrics2.nrSwarmPeers, 1, 'Peer 2 -> peer 3')
  t.is(metrics3.nrSwarmPeers, 2, 'Peer 3 -> peer 1 + 2')

  t.is(metrics1.nrSwarmHosts, 1) // All share same (local)host, so not an ideal test
  t.is(metrics1.nrDhtHosts, 1) // As above
  t.is(metrics1.nrDhtPeers, testnetSize - 1) // Bootstrap peer not included in the nodes
})

async function eventFlush () {
  await new Promise(resolve => setImmediate(resolve))
}
