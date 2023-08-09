const b4a = require('b4a')
const { id: getDhtId } = require('dht-rpc/lib/peer.js')
const fastify = require('fastify')
const ReadyResource = require('ready-resource')
const safetyCatch = require('safety-catch')

function setupServer (instrumentedSwarm) {
  const server = fastify()

  server.get('/swarm/peerinfo', async function (req, reply) {
    const { port, host } = req.query

    const res = []
    for (const entry of instrumentedSwarm.peerInfos.values()) {
      const portOk = !port || `${entry.remotePort}` === port
      const hostOk = !host || entry.remoteHost === host
      if (portOk && hostOk) res.push(entry)
    }
    reply.send(res)
  })

  server.get('/swarm/peerinfo/:publicKey', async function (req, reply) {
    const { publicKey } = req.params

    const info = instrumentedSwarm.peerInfos.get(publicKey)
    if (!info) {
      reply.status(404)
    } else {
      reply.send(info)
    }
  })

  server.get('/swarm/dhtnode', async function (req, reply) {
    const res = []
    for (const entry of instrumentedSwarm.dhtNodes.values()) {
      res.push(entry)
    }
    reply.send(res)
  })

  server.get('/swarm/summary', async function (req, reply) {
    reply.send(Object.fromEntries(instrumentedSwarm.getMetrics()))
  })

  return server
}
class InstrumentedSwarm extends ReadyResource {
  constructor (swarm, { host, port } = {}) {
    super()

    this.connectionsOpened = 0
    this.connectionsClosed = 0

    this.swarm = swarm
    this.swarm.on('connection', conn => {
      this.connectionsOpened++
      conn.on('close', () => this.connectionsClosed++)
    })

    this.server = setupServer(this)
    this._appListeningProm = this.server.listen({ port, host })
    this._appListeningProm.catch(safetyCatch)
  }

  async _open () {
    await this._appListeningProm
  }

  async _close () {
    await this.server.close()
  }

  get serverPort () {
    return this.server.addresses()[0].port
  }

  get publicKey () {
    return b4a.toString(this.swarm.keyPair.publicKey, 'hex')
  }

  get dhtPort () {
    return this.swarm.dht.port
  }

  get dhtHost () {
    return this.swarm.dht.host
  }

  get connectionPort () {
    // TODO: check if always the same over all connections
    return [...this.peerInfos.values()][0]?.ownPort
  }

  get peers () {
    return this.swarm.peers
  }

  get connections () {
    return this.swarm.connections
  }

  get dhtNodes () {
    const res = new Map()
    for (const n of this.swarm.dht.nodes.toArray()) {
      const hexKey = b4a.toString(n.id, 'hex')
      const nodeInfo = {}
      for (const prop of Object.keys(n)) {
        // Get rid of references of ordered set datastruct
        if (prop !== 'next' && prop !== 'prev') {
          nodeInfo[prop] = n[prop]
        }
      }
      if (nodeInfo.id) nodeInfo.id = b4a.toString(nodeInfo.id, 'hex')
      res.set(hexKey, nodeInfo)
    }

    return res
  }

  get peerInfos () {
    const infos = new Map()

    for (const connection of this.connections) {
      const publicKey = b4a.toString(connection.remotePublicKey, 'hex')
      const peerInfo = this.peers.get(publicKey)
      const dhtId = b4a.toString(getDhtId(connection.rawStream.remoteHost, connection.rawStream.remotePort), 'hex')
      const dhtInfo = this.dhtNodes.get(dhtId)

      const info = {
        remoteHost: connection.rawStream.remoteHost,
        remotePort: connection.rawStream.remotePort,
        ownPort: connection.rawStream.socket._port, // TODO: use non-private accessor
        publicKey,
        banned: peerInfo.banned,
        priority: peerInfo.priority,
        client: peerInfo.client,
        topics: peerInfo.topics.map(t => b4a.toString(t, 'hex')),
        onDht: dhtInfo != null
      }

      // TODO: verify that, if a node is present on the DHT,
      // it can always be found this way
      // if (dhtInfo) {
      //   console.log('on DHT!', dhtInfo)
      //   console.log(info)
      // }
      infos.set(publicKey, info)
    }

    return infos
  }

  getMetrics () {
    const infos = this.peerInfos
    const dhtNodes = this.dhtNodes

    const infoArray = [...infos.values()]
    const dhtNodesArray = [...dhtNodes.values()]

    const res = new Map()
    res.set('nrSwarmPeers', infos.size)
    res.set('nrSwarmHosts', (new Set(infoArray.map(i => i.remoteHost))).size)
    res.set('nrDhtPeers', dhtNodes.size)
    res.set('nrDhtHosts', (new Set(dhtNodesArray.map(n => n.host))).size)
    res.set('connectionsOpened', this.connectionsOpened)
    res.set('connectionsClosed', this.connectionsClosed)

    // I think this will always be 2 anyway, 1 client and 1 server socket
    // res.set('nrSocketsUsed', (new Set([
    //   ...dhtNodesArray.map(n => `${n.to.port}`),
    //   ...infoArray.map(i => `${i.dhtPort}`)
    // ])).size)

    // const nrTicksConnectedDhtOverview = new Map()
    // for (const [hexKey, node] of dhtNodes) {
    //   nrTicksConnectedDhtOverview.set(hexKey, node.pinged - node.added)
    // }

    return res
  }
}

module.exports = InstrumentedSwarm
