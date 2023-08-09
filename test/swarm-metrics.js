const test = require('brittle')
const RAM = require('random-access-memory')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const createTestnet = require('hyperdht/testnet')
const axios = require('axios')

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

  const host = '127.0.0.1'
  const iSwarm1 = new InstrumentedSwarm(swarm1, { host })
  const iSwarm2 = new InstrumentedSwarm(swarm2, { host })
  const iSwarm3 = new InstrumentedSwarm(swarm3, { host })
  await Promise.all([iSwarm1.ready(), iSwarm2.ready(), iSwarm3.ready()])

  t.teardown(async () => {
    await Promise.all([iSwarm1.close(), iSwarm2.close(), iSwarm3.close()])
    await Promise.all([swarm1.destroy(), swarm2.destroy(), swarm3.destroy()])
    await Promise.all([store1.close(), store2.close(), store3.close()])
    await testnet.destroy()
  })

  return { iSwarm1, iSwarm2, iSwarm3, core1, core2 }
}

test('instrumented swarm - props', async function (t) {
  const { iSwarm1, iSwarm3 } = await setup(t)
  const swarm1 = iSwarm1.swarm

  t.is(iSwarm1.dhtHost, swarm1.dht.host)
  t.is(iSwarm1.dhtPort, swarm1.dht.port)
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

  await Promise.all([iSwarm1.close(), iSwarm3.close()])
})

test('instrumented swarm - metrics', async function (t) {
  const testnetSize = 5
  const { iSwarm1, iSwarm2, iSwarm3 } = await setup(t, testnetSize)

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

test('get /peerInfo endpoint', async function (t) {
  const { iSwarm1, iSwarm2, iSwarm3 } = await setup(t)

  const url = `http://127.0.0.1:${iSwarm3.serverPort}/swarm`

  const res = await axios.get(`${url}/peerinfo`)
  t.is(res.status, 200)
  t.is(res.data.length, 2, 'peer 1 and 2')
  t.alike(
    new Set(res.data.map(i => i.publicKey)),
    new Set([iSwarm1.publicKey, iSwarm2.publicKey]),
    'result contains entry for the expected swarms'
  )
})

test('get /peerInfo endpoint with port query param', async function (t) {
  const { iSwarm1, iSwarm3 } = await setup(t)
  const url = `http://127.0.0.1:${iSwarm3.serverPort}/swarm`

  const res = await axios.get(`${url}/peerinfo`, { params: { port: iSwarm1.connectionPort } })
  t.is(res.status, 200)
  t.is(res.data.length, 1, 'only peer 1 matched port')
  t.is(res.data[0].publicKey, iSwarm1.publicKey)
})

test('get /peerInfo endpoint with port and host query params', async function (t) {
  const { iSwarm1, iSwarm3 } = await setup(t)
  const url = `http://127.0.0.1:${iSwarm3.serverPort}/swarm`

  // All nodes are on the same host, so this test
  // is not testing the host-filter logic.
  // It does make it easier to figure out our own host in the other's eyes
  const host = iSwarm3.peerInfos.get(iSwarm1.publicKey).remoteHost

  const res = await axios.get(
    `${url}/peerinfo`,
    { params: { port: iSwarm1.connectionPort, host } }
  )

  t.is(res.status, 200)
  t.is(res.data.length, 1, 'only peer 1 matched port')
  t.is(res.data[0].publicKey, iSwarm1.publicKey)

  const res2 = await axios.get(
    `${url}/peerinfo`,
    { params: { host } }
  )
  t.is(res2.data.length, 2, 'Sanity check: without port-filter both peers are matched')
})

test('get /peerInfo/:pubkey endpoint happy path', async function (t) {
  const { iSwarm1, iSwarm3 } = await setup(t)

  const url = `http://127.0.0.1:${iSwarm3.serverPort}/swarm`
  const res = await axios.get(`${url}/peerinfo/${iSwarm1.publicKey}`)
  t.is(res.status, 200)
  t.is(res.data.publicKey, iSwarm1.publicKey)
})

test('get /peerInfo/:pubkey endpoint 404 if not found', async function (t) {
  const { iSwarm3 } = await setup(t)

  const url = `http://127.0.0.1:${iSwarm3.serverPort}/swarm`
  const res = await axios.get(`${url}/peerinfo/${'a'.repeat(64)}`, { validateStatus: false })
  t.is(res.status, 404)
})

test('get dhtnode endpoint', async function (t) {
  const testnetSize = 5
  const { iSwarm1 } = await setup(t, testnetSize)

  const url = `http://127.0.0.1:${iSwarm1.serverPort}/swarm`
  const res = await axios.get(`${url}/dhtnode`)

  t.is(res.status, 200)
  t.is(res.data.length, 4, '5 testnetnodes minus the bootstrap')
  t.is(res.data[0].id.length, 64, 'sanity check that structure is as expected')
})

test('get summary endpoint', async function (t) {
  const testnetSize = 5
  const { iSwarm1, iSwarm3, core2 } = await setup(t, testnetSize)

  const url3 = `http://127.0.0.1:${iSwarm3.serverPort}/swarm`
  const res = await axios.get(`${url3}/summary`)

  t.is(res.status, 200)
  t.is(res.data.nrSwarmPeers, 2)
  t.is(res.data.nrSwarmHosts, 1)
  t.is(res.data.nrDhtPeers, testnetSize - 1)
  t.is(res.data.nrDhtHosts, 1)
  t.is(res.data.connectionsOpened, 0)
  t.is(res.data.connectionsClosed, 0)

  iSwarm1.swarm.join(core2.discoveryKey)
  await iSwarm1.swarm.flush()
  await eventFlush() // Unsure if needed

  const url1 = `http://127.0.0.1:${iSwarm1.serverPort}/swarm`
  const res2 = await axios.get(`${url1}/summary`)

  t.is(res2.data.connectionsOpened, 1)
  t.is(res2.data.connectionsClosed, 0)
})

async function eventFlush () {
  await new Promise(resolve => setImmediate(resolve))
}
