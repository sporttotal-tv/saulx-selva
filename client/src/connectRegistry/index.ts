import { SelvaClient, ConnectOptions, ServerDescriptor } from '..'
import { createConnection, connections } from '../connection'
import { REGISTRY_UPDATE } from '../constants'
import getInitialRegistryServers from './getInitialRegistryServers'
import addServer from './addServer'
import removeServer from './removeServer'
import { serverId } from '../util'
import moveReplicas from './moveReplicas'

/*
 registry-update
  events
  'new-server'
  'remove-server'
  'move-subscription'
  registry-server-info
    sends updates of all info objects (make this specific as well)
*/

const updateServerListeners = (selvaClient: SelvaClient) => {
  if (selvaClient.addServerUpdateListeners.length) {
    const len = selvaClient.addServerUpdateListeners.length
    for (let i = 0; i < len; i++) {
      selvaClient.addServerUpdateListeners[i]()
    }
    if (selvaClient.addServerUpdateListeners.length > len) {
      selvaClient.addServerUpdateListeners = selvaClient.addServerUpdateListeners.slice(len)
    } else {
      selvaClient.addServerUpdateListeners = []
    }
  }
}

export default (selvaClient: SelvaClient, connectOptions: ConnectOptions) => {
  if (connectOptions instanceof Promise) {
    // do shit
  } else if (typeof connectOptions === 'function') {
    // do shit also
  } else {
    const { port = 6379, host = '0.0.0.0' } = connectOptions

    if (selvaClient.registryConnection) {
      console.info('Update existing connection to registry')
    } else {
      const registryConnection = createConnection({
        type: 'registry',
        name: 'registry',
        port,
        host
      })

      // maybe for registry we want to handle it a bit different....
      registryConnection.attachSelvaClient(selvaClient)

      selvaClient.registryConnection = registryConnection

      registryConnection.subscribe(REGISTRY_UPDATE, selvaClient.selvaId)

      selvaClient.registryConnection.on('connect', () => {
        getInitialRegistryServers(selvaClient).then(() => {
          selvaClient.emit('added-servers', { event: '*' })
          updateServerListeners(selvaClient)
        })
      })

      // if a registry client is being re-used
      if (selvaClient.registryConnection.connected) {
        // not a promise is faster
        getInitialRegistryServers(selvaClient).then(() => {
          selvaClient.emit('added-servers', { event: '*' })
          updateServerListeners(selvaClient)
        })
      }

      const clear = () => {
        selvaClient.servers = {
          ids: new Set(),
          origins: {},
          subsManagers: [],
          replicas: {}
        }
        selvaClient.emit('removed-servers', { event: '*' })
      }

      selvaClient.registryConnection.on('close', clear)
      selvaClient.registryConnection.on('disconnect', clear)

      registryConnection.addRemoteListener('message', (channel, msg) => {
        if (channel === REGISTRY_UPDATE) {
          const payload = JSON.parse(msg)
          const { event } = payload
          if (event === 'new') {
            const { server } = payload
            if (addServer(selvaClient, <ServerDescriptor>server)) {
              selvaClient.emit('added-servers', payload)
              updateServerListeners(selvaClient)
            }
          } else if (event === 'remove') {
            const { server } = payload
            if (removeServer(selvaClient, <ServerDescriptor>server)) {
              const id = serverId(server)
              const connection = connections.get(id)
              // if its from this we know to increase a counter for soft ramp up
              if (connection) {
                if (!connection.isDestroyed) {
                  console.log(
                    'Incoming remove event from registry - hard dc',
                    id
                  )
                  connection.hardDisconnect()
                }
              }
              selvaClient.emit('removed-servers', payload)
            }
          } else if (event === 'move-sub') {
            console.log('MOVE SUBSCRIPTION')
          } else if ('update-index') {
            // now we are going to move them!
            // can be either a subs manager update of index or replica
            const { type, move } = payload
            if (type === 'replica') {
              moveReplicas(selvaClient, move)
            }
          }
        }
      }, selvaClient.selvaId)

      // add listeners
      selvaClient.emit('registry-started')
      updateServerListeners(selvaClient)
    }
  }
}
