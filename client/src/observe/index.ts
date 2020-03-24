import { SelvaClient } from '..'
import { GetOptions, GetResult } from '../get/types'
import Observable from './observable'
import { createHash } from 'crypto'

type ObserveOptions = {
  getLatest: boolean
}

function makeSubscriptionId(opts: GetOptions) {
  const hash = createHash('sha256')
  hash.update(JSON.stringify(opts))
  return hash.digest('hex')
}

export async function observe(
  client: SelvaClient,
  props: GetOptions,
  opts: ObserveOptions = { getLatest: true }
): Promise<Observable<GetResult>> {
  const subscriptionId = makeSubscriptionId(props)

  // props optional
  const obs = client.redis.subscribe(
    `___selva_subscription:${subscriptionId}`,
    props
  )
  return new Observable<GetResult>(observe => {
    const sub = obs.subscribe({
      next: (x: GetResult) => {
        observe.next(x)
      },
      error: observe.error,
      complete: observe.complete
    })

    return <any>sub
  })
}
