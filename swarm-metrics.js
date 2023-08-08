const b4a = require('b4a')
const { id: getDhtId } = require('dht-rpc/lib/peer.js')

class InstrumentedSwarm {
  constructor (swarm, { host, port } = {}) {
    this.swarm = swarm
  }

  get publicKey () {
    return b4a.toString(this.swarm.keyPair.publicKey, 'hex')
  }

  get ownHost () {
    return this.swarm.dht.host
  }

  get ownPort () {
    return this.swarm.dht.port
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
        ownPort: connection.rawStream.socket._port,
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

    // I think this will always be 2 anyway, 1 client and 1 server socket
    // res.set('nrSocketsUsed', (new Set([
    //   ...dhtNodesArray.map(n => `${n.to.port}`),
    //   ...infoArray.map(i => `${i.ownPort}`)
    // ])).size)

    // const nrTicksConnectedDhtOverview = new Map()
    // for (const [hexKey, node] of dhtNodes) {
    //   nrTicksConnectedDhtOverview.set(hexKey, node.pinged - node.added)
    // }

    return res
  }
}

module.exports = InstrumentedSwarm
