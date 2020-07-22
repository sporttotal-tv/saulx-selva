import { SubscriptionManager, Subscription } from './types'
import { constants } from '@saulx/selva'
import traverseTree from './update/traverseTree'
import addUpdate from './update/addUpdate'
import { ServerSelector } from '@saulx/selva/dist/src/types'

const { EVENTS } = constants

const prefixLength = EVENTS.length
const deleteLength = 'delete:'.length

// pass subscription
const addOriginListeners = async (
  name: string,
  subsManager: SubscriptionManager,
  subscription: Subscription
) => {
  // we need to use name and unsubscribe as well

  if (!subsManager.originListeners[name]) {
    console.log('add origin listeners', name)

    const selector: ServerSelector = { name, type: 'replica' }

    const descriptor = await subsManager.client.getServerDescriptor(selector)

    const listener = (_pattern, channel, message) => {
      subsManager.incomingCount++
      collect++
      if (message === 'schema_update') {
        const subscription =
          subsManager.subscriptions[`${constants.SCHEMA_SUBSCRIPTION}:${name}`]
        if (subscription) {
          addUpdate(subsManager, subscription)
        }
      } else {
        const eventName = channel.slice(prefixLength)
        // make this batch as well (the check)
        if (message === 'update') {
          traverseTree(subsManager, eventName, name)
        } else if (message && message.startsWith('delete')) {
          const fields = message.slice(deleteLength).split(',')

          fields.forEach((v: string) => {
            traverseTree(subsManager, eventName + '.' + v, name)
          })
        }
      }

      if (!subsManager.stagedInProgess) {
        subsManager.incomingCount = 0
      }
    }

    subsManager.originListeners[name] = {
      subscriptions: new Set(),
      listener,
      reconnectListener: descriptor => {
        const { name: dbName } = descriptor
        console.log('reconn in subs manager', name)
        if (name === dbName) {
          // need to resend subs if it dc'ed
          const origin = subsManager.originListeners[name]
          console.log('---> reconnect', descriptor.port, name, !!origin)

          if (origin && origin.subscriptions) {
            console.log('go resend those subs')
            origin.subscriptions.forEach(subscription => {
              console.log('go do it', subscription.get)
              addUpdate(subsManager, subscription)
            })
          }
        }
      }
    }

    const { client } = subsManager
    const redis = client.redis
    let collect = 0

    client.on('reconnect', subsManager.originListeners[name].reconnectListener)

    redis.on(descriptor, 'pmessage', listener)
    redis.psubscribe(descriptor, EVENTS + '*')
  }

  subsManager.originListeners[name].subscriptions.add(subscription)
}

const removeOriginListeners = (
  name: string,
  subsManager: SubscriptionManager,
  subscription: Subscription
) => {
  const origin = subsManager.originListeners[name]

  console.log('remove origin', name)

  if (origin) {
    const { client } = subsManager
    const redis = client.redis
    origin.subscriptions.delete(subscription)
    if (origin.subscriptions.size === 0) {
      if (name in subsManager.memberMemCache) {
        delete subsManager.memberMemCache[name]
      }
      redis.punsubscribe({ name }, EVENTS + '*')
      client.removeListener('reconnect', origin.reconnectListener)
      redis.removeListener({ name }, 'pmessage', origin.listener)
      delete subsManager.originListeners[name]
    }
  }
}

export { addOriginListeners, removeOriginListeners }
