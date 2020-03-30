import { GetResult, GetOptions } from '../get/types'
import Redis from './'
import { LogFn } from '..'

type Resolvable = {
  resolve?: (x: any) => void
  reject?: (x: Error) => void
}

export type RedisCommand = Resolvable & {
  command: string
  type?: string
  args: (string | number)[]
  hash?: number
}

// different heartbeat event will be gone
export type UpdateEvent = {
  type: 'update'
  payload: GetResult
}

export type DeleteEvent = {
  type: 'delete'
}

export type Event = UpdateEvent | DeleteEvent

export type ClientObject = {
  connect: (type: string) => void
  disconnect: (type: string) => void
  message: (channel: string, message: string) => void
  log?: LogFn
  client: Redis
}