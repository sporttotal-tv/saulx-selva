import { Fork } from './types'
import { GetOptions, Find } from '~selva/get/types'
import { stringStartsWith, now } from 'lua/src/util'
import * as logger from '../../logger'

export function getFind(opts: GetOptions): Find | undefined {
  if (opts.$list && typeof opts.$list === 'object' && opts.$list.$find) {
    return opts.$list.$find
  } else if (opts.$find) {
    return opts.$find
  }
  return undefined
}

export function isFork(x: any): x is Fork {
  return type(x) === 'table' && x.isFork
}

export function convertNow(x: string): number {
  const unitLetters = {
    s: true,
    m: true,
    h: true,
    d: true
  }

  if (!stringStartsWith(x, 'now')) {
    return 0
  }

  if (x.length === 3) {
    // just 'now'
    return now()
  }

  const op = x[3]
  if (op === '+' || op === '-') {
    let offsetStr = x.substr(3)
    let unit = offsetStr[offsetStr.length - 1]
    if (!unitLetters[unit]) {
      offsetStr += unit
    } else {
      offsetStr = offsetStr.substr(0, offsetStr.length - 1)
    }

    let offset = tonumber(offsetStr)
    if (!offset) {
      return 0
    }

    // convert unit to ms
    if (unit === 's') {
      offset *= 1000
    } else if (unit === 'm') {
      offset *= 1000
      offset *= 60
    } else if (unit === 'h') {
      offset *= 1000
      offset *= 60
      offset *= 60
    } else if (unit === 'd') {
      offset *= 1000
      offset *= 60
      offset *= 60
      offset *= 24
    }

    return now() + offset
  } else {
    return 0
  }
}
