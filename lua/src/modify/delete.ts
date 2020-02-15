import { Id } from '~selva/schema/index'
import { markForAncestorRecalculation } from './ancestors'
import * as r from '../redis'
import sendEvent from './events'

export function deleteItem(id: Id, hierarchy: boolean = true): boolean {
  if (hierarchy) {
    const children = r.smembers(id + '.children')
    const parents = r.smembers(id + '.parents')
    for (let parent of parents) {
      r.srem(parent + '.children', id)
    }
    for (let child of children) {
      const key = child + '.parents'
      r.srem(key, id)
      const size = r.scard(key)
      if (size === 0) {
        deleteItem(child)
      } else {
        markForAncestorRecalculation(child)
      }
    }
  }

  redis.pcall('FT.DEL', 'default', id)
  r.del(id + '.children')
  r.del(id + '.parents')
  r.del(id + '.ancestors')
  r.del(id + '._depth')
  sendEvent(id, '', 'delete')

  const vals = r.hgetall(id)
  for (let i = 0; i < vals.length; i += 2) {
    // found a set value, cleaning up the set key
    if (vals[i + 1] === '___selva_$set') {
      r.del(id + '.' + vals[i])
    }
  }

  // returns true if it existed
  return r.del(id) > 0
}
