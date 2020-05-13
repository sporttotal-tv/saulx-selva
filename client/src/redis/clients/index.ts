import { RedisClient } from 'redis'
import { RedisCommand } from '../types'
import RedisSelvaClient from '../'
import './redisSearch'
import { ServerType } from '../../types'
import { EventEmitter } from 'events'
import createRedisClient from './createRedisClient'
import { loadScripts } from './scripts'
import drainQueue from './drainQueue'
import { v4 as uuidv4 } from 'uuid'
import startHeartbeat from './startHeartbeat'

type ClientOpts = {
  name: string
  type: ServerType
  host: string
  port: number
  id: string
}

export class Client extends EventEmitter {
  public subscriber: RedisClient
  public publisher: RedisClient
  public queue: RedisCommand[]
  public queueInProgress: boolean
  public name: string // for logging
  public type: ServerType // for logs
  public id: string // url:port
  public connected: boolean
  public uuid: string
  public serverIsBusy: boolean // can be written from the registry
  public scripts: {
    batchingEnabled: { [scriptSha: string]: boolean }
    sha: { [scriptName: string]: string }
  }
  public clients: Set<RedisSelvaClient>
  public heartbeatTimout?: NodeJS.Timeout

  constructor({ name, type, host, port, id }: ClientOpts) {
    super()
    this.setMaxListeners(10000)
    this.uuid = uuidv4()
    this.name = name
    this.type = type
    this.id = id
    this.clients = new Set()
    this.scripts = { batchingEnabled: {}, sha: {} }
    this.serverIsBusy = false
    this.queueInProgress = false
    this.queue = []
    this.connected = false

    this.on('connect', () => {
      if (!this.connected) {
        console.log('client connected', name)
        this.connected = true
        drainQueue(this)
        if (
          type === 'subscriptionManager' &&
          process.env.SELVA_SERVER_TYPE !== 'subscriptionManager'
        ) {
          console.log('start it!')
          startHeartbeat(this)
        }
      }
    })

    this.on('disconnect', () => {
      this.connected = false
      this.queueInProgress = false
      clearTimeout(this.heartbeatTimout)
    })

    this.subscriber = createRedisClient(this, host, port, 'subscriber')
    this.publisher = createRedisClient(this, host, port, 'publisher')
  }
}

const clients: Map<string, Client> = new Map()

const createClient = (
  name: string,
  type: ServerType,
  id: string,
  port: number,
  host: string
): Client => {
  const client: Client = new Client({
    id,
    name,
    type,
    port,
    host
  })
  return client
}

const destroyClient = () => {
  // remove hearthbeat
}

export function removeRedisSelvaClient(
  client: Client,
  selvaRedisClient: RedisSelvaClient
) {}

export function addRedisSelvaClient(
  client: Client,
  selvaRedisClient: RedisSelvaClient
) {
  //
}

export function getClient(
  selvaRedisClient: RedisSelvaClient,
  name: string,
  type: ServerType,
  port: number,
  url: string = '0.0.0.0'
) {
  // if origin || registry

  const id = url + ':' + port
  let client = clients.get(id)
  if (!client) {
    client = createClient(name, type, id, port, url)
    clients.set(id, client)
  }

  if (type === 'origin' || /* TODO: remove */ type === 'registry') {
    loadScripts(client)
  }

  addRedisSelvaClient(client, selvaRedisClient)

  return client
}

export function addCommandToQueue(client: Client, redisCommand: RedisCommand) {
  client.queue.push(redisCommand)
  if (!client.queueInProgress) {
    drainQueue(client)
  }
}
