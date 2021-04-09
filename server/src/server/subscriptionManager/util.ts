import { createHash } from 'crypto'
import { stringHash as hash } from '@sporttotal/utils'

export function LargeHash(str: string): string {
  const hashingFn = createHash('sha256')
  hashingFn.update(str)
  return hashingFn.digest('hex')
}

export { hash }
