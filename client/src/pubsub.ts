import Observable from './observe/observable'
import { createClient, RedisClient as Redis } from 'redis'
import { GetResult, GetOptions } from './get/types'
import { EventEmitter } from 'events'
import { ConnectOptions } from './redis'
import { LogFn } from '.'

type RedisSubsription = {
  channel: string
  active: boolean
  emitter: EventEmitter
  getOpts: GetOptions
}

type UpdateEvent = {
  type: 'update'
  payload: GetResult
}

type DeleteEvent = {
  type: 'delete'
}

type HeartBeatEvent = {
  type: 'heartbeat'
}

type Event = UpdateEvent | HeartBeatEvent | DeleteEvent

export default class SelvaPubSub {
  private subscriptions: { [channel: string]: RedisSubsription } = {}
  private lastHeartbeat: { [channel: string]: number } = {}
  private pub: Redis
  private sub: Redis
  private heartbeatTimer: NodeJS.Timeout
  private opts: ConnectOptions
  private connected: boolean = false
  private clientId: string
  private log: LogFn

  connect(opts: ConnectOptions) {
    this.opts = opts
    this.pub = createClient(opts)
    this.sub = createClient(opts)

    this.sub.on('error', err => {
      // console.log('ERRRRR')
      if (err.code === 'ECONNREFUSED') {
        console.info(`Connecting to ${err.address}:${err.port}`)
      } else {
        // console.log('ERR', err)
      }
    })

    this.pub.on('error', err => {
      // console.log('ERRRRR')
      if (err.code === 'ECONNREFUSED') {
        console.info(`Connecting to ${err.address}:${err.port}`)
      } else {
        // console.log('ERR', err)
      }
    })

    this.sub.on('ready', () => {
      this.connected = true
      this.ensureSubscriptions()
      this.attachLogging()
    })

    this.pub.on('ready', () => {
      this.connected = true
      this.startHeartbeats()
    })
  }

  disconnect() {
    this.stopHeartbeats()
    this.markSubscriptionsClosed()

    this.connected = false
    if (this.pub) {
      this.pub.quit()
    }

    if (this.sub) {
      this.sub.quit()
    }

    this.pub = this.sub = undefined
  }

  attachLogging() {
    this.sub.subscribe(`___selva_lua_logs:${this.clientId}`)
  }

  configureLogs(clientId: string, logFn: LogFn) {
    if (clientId) {
      this.clientId = clientId
    }

    this.log = logFn
  }

  subscribe(channel: string, getOpts: GetOptions) {
    const current = this.subscriptions[channel]
    if (current && current.active) {
      return
    }

    const emitter = new EventEmitter()

    this.subscriptions[channel] = {
      channel,
      active: this.connected,
      emitter,
      getOpts
    }

    if (this.connected) {
      this.sub.subscribe(channel)
      this.lastHeartbeat[channel] = Date.now()
      this.setSubcriptionData(channel)
    }

    return new Observable(observer => {
      emitter.on('publish', str => {
        const event: Event = JSON.parse(str)

        if (event.type === 'update') {
          observer.next(event.payload)
        } else if (event.type === 'delete') {
          observer.next(null)
        } else if (event.type === 'heartbeat') {
          this.lastHeartbeat[channel] = Date.now()
        }
      })

      return () => {
        this.sub.unsubscribe(channel)
        delete this.subscriptions[channel]
        delete this.lastHeartbeat[channel]
      }
    })
  }

  private attemptReconnect() {
    this.disconnect()
    setTimeout(() => this.connect(this.opts), 1000)
  }

  private startHeartbeats() {
    if (this.heartbeatTimer) {
      return
    }

    const timeout = () => {
      this.heartbeatTimer = setTimeout(() => {
        for (const channel in this.lastHeartbeat) {
          if (
            this.lastHeartbeat[channel] &&
            Date.now() - this.lastHeartbeat[channel] > 1000 * 60
          ) {
            // it's been too long since latest server heartbeat, disconnecting and connecting again in a second
            this.attemptReconnect()
          }
        }

        if (this.connected && this.pub) {
          for (const channel in this.subscriptions) {
            this.pub.publish(
              '___selva_subscription:client_heartbeats',
              JSON.stringify({ channel })
            )
          }
        } else {
          this.stopHeartbeats()
          return
        }

        timeout()
      }, 1000 * 30)
    }

    timeout()
  }

  private stopHeartbeats() {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }

  private async ensureSubscriptions() {
    for (const channel in this.subscriptions) {
      if (!this.subscriptions[channel].active) {
        this.sub.subscribe(channel)
        this.subscriptions[channel].active = true

        await this.setSubcriptionData(channel)
      }
    }

    // ensure old listener is gone
    this.sub.removeAllListeners('message')

    this.sub.on('message', (channel, message) => {
      // does this allways happen now?
      if (channel.startsWith('___selva_lua_logs:') && this.log) {
        this.log(JSON.parse(message))
        return
      }

      const sub = this.subscriptions[channel]

      if (sub) {
        sub.emitter.emit('publish', message)
      }
    })
  }

  // public async unsubscribe (channel: string) {

  // }

  private async setSubcriptionData(channel: string) {
    try {
      await new Promise((resolve, reject) => {
        const tx = this.pub.multi()
        tx.hset(
          '___selva_subscriptions',
          channel.substr('___selva_subscription:'.length),
          JSON.stringify(this.subscriptions[channel].getOpts)
        )

        tx.hset(
          '___selva_subscriptions',
          '___lastEdited',
          new Date().toISOString()
        )

        tx.exec((err, _replies) => {
          if (err) {
            this.attemptReconnect()
            return reject(err)
          }

          this.pub.publish(
            '___selva_subscription:client_heartbeats',
            JSON.stringify({ channel, refresh: true })
          )
          resolve()
        })
      })
    } catch (e) {
      console.error(e)
      return
    }
  }

  async markSubscriptionsClosed() {
    for (const channel in this.subscriptions) {
      this.subscriptions[channel].active = false
    }
  }
}
