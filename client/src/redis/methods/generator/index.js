const fs = require('fs')
const redis = require('redis')
const path = require('path')

// TODO: use replica fro all read operations if type !== subs manager && type !== '

let template = `
type args = (string | number)[]
import { RedisCommand } from '../types'
import { ServerSelector } from '../../types'

abstract class RedisMethods {
  abstract addCommandToQueue(
    redisCommand: RedisCommand,
    opts?: ServerSelector
  ): void
  async command(opts: ServerSelector, key: string, ...args: args): Promise<any>
  async command(key: string, ...args: args): Promise<any>
  async command(opts: any, ...args: args): Promise<any> {
    if (typeof opts === 'object') {
      return new Promise((resolve, reject) => {
        const [key, ...commandArgs] = args
        this.addCommandToQueue({ command: <string>key, args: commandArgs, resolve, reject }, opts)
      })
    } else {
      return new Promise((resolve, reject) => {
        this.addCommandToQueue({ command: opts, args, resolve, reject })
      })
    }
  }
  $methods
}

export default RedisMethods
`

const methods = []

// redis.add_command(`FT.${cmd}`)
const proto = redis.RedisClient.prototype
for (const key in redis.RedisClient.prototype) {
  if (/[A-Z]/.test(key[0]) && typeof proto[key] === 'function') {
    const command = key.toLowerCase()
    if (command === 'command' || !/^([a-z])+$/.test(command)) {
      continue
    }

    methods.push(
      `
async ${command}(opts: ServerSelector, ...args: args): Promise<any>
async ${command}(...args: args): Promise<any>
async ${command}(opts: any, ...args: args): Promise<any> {
  if (typeof opts === 'object') {
    return new Promise((resolve, reject) => {
      this.addCommandToQueue({ command: '${command}', args, resolve, reject }, opts)
    })
  } else {
    return new Promise((resolve, reject) => {
      this.addCommandToQueue({ command: '${command}', args: [opts, ...args], resolve, reject })
    })
  }
}
`
    )
  }
}

template = template.replace('$methods', methods.join('\n'))

fs.writeFileSync(path.join(__dirname, '../index.ts'), template)
