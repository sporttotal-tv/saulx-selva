import { SelvaClient, ServerType, connect } from '../'
import {
  ClientOpts,
  ConnectOptions,
  ServerSelector,
  ServerDescriptor
} from '../types'
import { RedisCommand } from './types'
import RedisMethods from './methods'
import { v4 as uuidv4 } from 'uuid'
import { GetSchemaResult } from '../schema/types'
import { getClient, Client, addCommandToQueue } from './clients'
import getSchema from './getSchema'

// now connect to registry make make
// re attach to different clients if they stop working

type Callback = (payload: any) => void

// add schema handling subscriptions / unsubscribe destorying making clients

class RedisSelvaClient extends RedisMethods {
  public selvaClient: SelvaClient

  public queue: { command: RedisCommand; selector: ServerSelector }[] = []
  public listenerQueue: {
    selector: ServerSelector
    event: string
    callback: Callback
  }[] = []

  public registry: Client

  public id: string

  constructor(
    selvaClient: SelvaClient,
    connectOptions: ConnectOptions,
    opts: ClientOpts
  ) {
    super()
    this.id = uuidv4()
    this.selvaClient = selvaClient
    // opts for logs

    if (typeof connectOptions === 'function') {
    } else if (connectOptions instanceof Promise) {
    } else {
      console.log('start with non async connect')
      // need an emitter or attach to publisher

      // schema: boolean = false
      this.registry = getClient(
        this,
        'registry',
        'registry',
        connectOptions.port,
        connectOptions.host
      )
    }
    // connect to registy here
  }

  async getServerDescriptor(
    selector: ServerSelector
  ): Promise<ServerDescriptor> {
    const descriptor = {}

    if (selector.name) {
      // not enoguh ofc
      return { name: selector.name }
    } else if (selector.type === 'registry') {
      return { name: 'registry' }
    } else {
      // find it in the registry!
      return { name: 'default' }
    }
  }

  async getSchema(selector: ServerSelector): Promise<GetSchemaResult> {
    return getSchema(this, selector)
  }

  on(selector: ServerSelector, event: string, callback: Callback): void
  on(event: string, callback: Callback): void
  on(selector: any, event: any, callback?: any): void {
    if (!this.registry) {
      this.listenerQueue.push({ selector, event, callback })
    } else {
      if (typeof selector === 'string') {
        callback = event
        event = selector
        // if replica is available
        selector = { name: 'default', type: 'replica' }
      }

      if (selector.type === 'registry') {
        this.registry.subscriber.on(event, callback)
      } else {
      }
    }
  }

  addCommandToQueue(
    command: RedisCommand,
    selector: ServerSelector = { name: 'default' }
  ) {
    if (!this.registry) {
      this.queue.push({ command, selector })
    } else {
      if (selector.type === 'registry') {
        addCommandToQueue(this.registry, command)
      } else {
      }
    }
  }
}

export default RedisSelvaClient
