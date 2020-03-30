import SubscriptionManager from './index'
import query from './query'

const addListeners = async (
  subsManager: SubscriptionManager
): Promise<void> => {
  console.log('add listeners')

  const heartbeatChannel = '___selva_subscription:heartbeat'
  const newSubscriptionChannel = '___selva_subscription:new'
  const removeSubscriptionChannel = '___selva_subscription:remove'
  const clients = `___selva_clients`

  subsManager.sub.on('message', (channel, message) => {
    if (channel === heartbeatChannel) {
      const { client, ts } = JSON.parse(message)
      if (!subsManager.clients[client]) {
        if (client !== subsManager.client.redis.redis.uuid) {
          console.log('received new client on server', client)
          subsManager.clients[client] = { subscriptions: [], lastTs: ts }
          subsManager.client.redis.hset(clients, client, ts)
        }
      } else {
        subsManager.clients[client].lastTs = ts
        subsManager.client.redis.hset(clients, client, ts)
      }
    } else if (channel === newSubscriptionChannel) {
      const { client, channel } = JSON.parse(message)
      console.log('Got a create sub on (server)', channel.slice(-5))
      subsManager.addSubscription(client, channel)
    } else if (channel === removeSubscriptionChannel) {
      const { client, channel } = JSON.parse(message)
      console.log('Got a remove sub on (server)', channel.slice(-5))
      subsManager.removeSubscription(client, channel)
    }
  })

  const prefixLength = '___selva_events:'.length

  subsManager.sub.on('pmessage', (_pattern, channel, message) => {
    // console.log('SERVER pmessage', channel, message)
    // subsManager.incomingCount++
    // const updatedSubscriptions: Record<string, true> = {}
    // const eventName = channel.slice(prefixLength)
    // check hearthbeat from lua
    // if (message === 'delete') {
    //   for (const field in subsManager.subscriptionsByField) {
    //     if (field.startsWith(eventName)) {
    //       const subscriptionIds: Set<string> | undefined =
    //         subsManager.subscriptionsByField[field] || new Set()
    //       for (const subscriptionId of subscriptionIds) {
    //         if (updatedSubscriptions[subscriptionId]) {
    //           continue
    //         }
    //         updatedSubscriptions[subscriptionId] = true
    //         subsManager.sendUpdate(subscriptionId, null, true)
    //       }
    //     }
    //   }
    //   return
    // } else if (message === 'update') {
    //   const parts = eventName.split('.')
    //   let field = parts[0]
    //   for (let i = 0; i < parts.length; i++) {
    //     const subscriptionIds: Set<string> | undefined =
    //       subsManager.subscriptionsByField[field] || new Set()
    //     for (const subscriptionId of subscriptionIds) {
    //       if (updatedSubscriptions[subscriptionId]) {
    //         continue
    //       }
    //       updatedSubscriptions[subscriptionId] = true
    //       subsManager.sendUpdate(subscriptionId).catch(e => {
    //         console.error(e)
    //       })
    //     }
    //     if (i < parts.length - 1) {
    //       field += '.' + parts[i + 1]
    //     }
    //   }
    // }
    // query(subsManager, message, eventName)
  })

  subsManager.sub.psubscribe('___selva_events:*')
  subsManager.sub.subscribe(newSubscriptionChannel)
  subsManager.sub.subscribe(heartbeatChannel)
  subsManager.sub.subscribe(removeSubscriptionChannel)
}

export default addListeners