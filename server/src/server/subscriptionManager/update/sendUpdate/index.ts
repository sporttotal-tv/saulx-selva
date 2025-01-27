import { constants } from '@saulx/selva'
import { addSubscriptionToTree, removeSubscriptionFromTree } from '../../tree'
import { hashObjectIgnoreKeyOrder, hash } from '@saulx/utils'
import { Subscription, SubscriptionManager } from '../../types'
import { wait } from '../../../../util'
import diff from '@saulx/selva-diff'
import chalk from 'chalk'

const { CACHE } = constants

const sendUpdate = async (
  subscriptionManager: SubscriptionManager,
  subscription: Subscription
) => {
  const channel = subscription.channel
  const { client, selector } = subscriptionManager
  const redis = client.redis

  if (subscriptionManager.subscriptions[channel] !== subscription) {
    subscription.beingProcessed = false
    return
  }

  subscriptionManager.inProgressCount++
  subscription.beingProcessed = true
  const getOptions = subscription.get
  getOptions.$includeMeta = true

  const startTime = Date.now()

  if (channel.startsWith(constants.SCHEMA_SUBSCRIPTION)) {
    const dbName = channel.slice(constants.SCHEMA_SUBSCRIPTION.length + 1)
    const schemaResp = await client.getSchema(dbName)
    const version = schemaResp.schema.sha

    const value = JSON.stringify({ type: 'update', payload: schemaResp.schema })
    await redis.hmset(
      selector,
      CACHE,
      channel,
      value,
      channel + '_version',
      version
    )

    console.log('Schema subscription took', Date.now() - startTime, 'ms')

    await redis.publish(selector, channel, JSON.stringify([version]))
    subscription.beingProcessed = false
    return
  }

  const time = setTimeout(() => {
    console.error(chalk.red('Time out (took longer then 15s)' + channel))
    console.dir(getOptions, { depth: 10 })
  }, 15e3)

  let payload
  try {
    payload = await client.get(getOptions)

    const t = Date.now() - startTime

    if (t > 300) {
      console.log('\n----------------------------------------------------')
      console.log('Get subscription took', t, 'ms')
      console.dir(getOptions, { depth: 10 })
      console.log('----------------------------------------------------')
    }
  } catch (err) {
    payload = {
      ___$error___: err.message
    }
  }

  const newTree = payload.$meta

  delete payload.$meta

  // TODO: lua is unstable with object tmp fix

  const newVersion = hashObjectIgnoreKeyOrder(payload)

  const resultStr = JSON.stringify({ type: 'update', payload })

  const currentVersion = subscription.version

  const treeVersion = subscription.treeVersion
  const q = []

  // if sub is removed
  if (
    subscriptionManager.subscriptions[subscription.channel] !== subscription
  ) {
    clearTimeout(time)
    subscriptionManager.inProgressCount--
    subscription.beingProcessed = false
    return
  }

  if (newTree) {
    const newTreeJson = JSON.stringify(newTree)
    const newTreeVersion = hash(newTreeJson)
    if (treeVersion !== newTreeVersion) {
      if (treeVersion) {
        removeSubscriptionFromTree(subscriptionManager, subscription)
      }
      subscription.treeVersion = newTreeVersion
      subscription.tree = newTree
      addSubscriptionToTree(subscriptionManager, subscription)
      q.push(redis.hset(selector, CACHE, channel + '_tree', newTreeJson))
    }
  } else if (treeVersion) {
    // remove tree ?
  }

  if (currentVersion === newVersion) {
    clearTimeout(time)
    subscriptionManager.inProgressCount--
    if (subscription.processNext) {
      await wait(100)
      subscription.processNext = false
      await sendUpdate(subscriptionManager, subscription)
    } else {
      subscription.beingProcessed = false
    }
    return
  }

  subscription.version = newVersion

  let patch

  // maybe add 'expirimental diffs enabled or something'
  if (currentVersion) {
    const prev = JSON.parse(await redis.hget(selector, CACHE, channel))
    // maybe gzip the patch (very efficient format for gzip)
    const diffPatch = diff(prev.payload, payload)

    // gzip only makes sense for a certain size of update
    // patch = (
    //   await (<Promise<Buffer>>gzip(JSON.stringify([diffPatch, currentVersion])))
    // ).toString('base64')
    // console.log('PATCH', patch)

    patch = JSON.stringify([diffPatch, currentVersion])
  }

  if (patch) {
    q.push(
      redis.hmset(
        selector,
        CACHE,
        channel,
        resultStr,
        channel + '_version',
        newVersion,
        channel + '_diff',
        patch
      )
    )
  } else {
    q.push(
      redis.hmset(
        selector,
        CACHE,
        channel,
        resultStr,
        channel + '_version',
        newVersion
      )
    )
  }

  await Promise.all(q)

  await redis.publish(
    selector,
    channel,
    JSON.stringify(currentVersion ? [newVersion, currentVersion] : [newVersion])
  )

  clearTimeout(time)

  subscriptionManager.inProgressCount--
  if (subscription.processNext) {
    await wait(100)
    subscription.processNext = false
    await sendUpdate(subscriptionManager, subscription)
  } else {
    subscription.beingProcessed = false
  }
}

export default sendUpdate
