import test from 'ava'
import { connect } from '../src/index'
import { start } from '@saulx/selva-server'
import './assertions'
import getPort from 'get-port'

let srv
let port: number
test.before(async t => {
  port = await getPort()
  srv = await start({
    port
  })

  const client = connect({ port })
  await client.updateSchema({
    languages: ['en', 'en_us', 'en_uk', 'de', 'nl'],
    types: {
      club: {
        prefix: 'cl',
        fields: {
          specialMatch: { type: 'reference' },
          value: { type: 'number' },
          age: { type: 'number' },
          auth: {
            type: 'json'
          },
          title: { type: 'text' },
          description: { type: 'text' },
          image: {
            type: 'object',
            properties: {
              thumb: { type: 'string' },
              poster: { type: 'string' }
            }
          }
        }
      },
      match: {
        prefix: 'ma',
        fields: {
          title: { type: 'text' },
          description: { type: 'text' }
        }
      }
    }
  })

  await client.destroy()
})

test.after(async _t => {
  const client = connect({ port })
  await client.delete('root')
  await client.destroy()
  await srv.destroy()
})

test.serial('simple singular reference', async t => {
  const client = connect({ port })

  const match1 = await client.set({
    $id: 'maA',
    title: {
      en: 'yesh match'
    }
  })

  const club1 = await client.set({
    $id: 'clA',
    title: {
      en: 'yesh club'
    },
    specialMatch: match1
  })

  console.log(
    await client.get({
      $id: 'clA',
      $language: 'en',
      title: true,
      specialMatch: true
    })
  )

  console.log(
    await client.get({
      $id: 'clA',
      $language: 'en',
      title: true,
      specialMatch: {
        title: true
      }
    })
  )
})
