import test from 'ava'
import { connect } from '../src/index'
import { start } from '@saulx/selva-server'
import './assertions'
import { wait } from './assertions'
import getPort from 'get-port'

let srv
let port: number
test.before(async (t) => {
  port = await getPort()
  srv = await start({
    port,
  })
  const client = connect({ port })
  await client.updateSchema({
    languages: ['en', 'de'],
    types: {
      match: {
        prefix: 'ma',
        fields: {
          title: {
            type: 'text',
            search: { type: ['TEXT-LANGUAGE-SUG'] },
          },
          published: { type: 'boolean', search: { type: ['TAG'] } },
          awayTeam: { type: 'reference' },
          homeTeam: { type: 'reference' },
          image: {
            type: 'object',
            properties: {
              thumb: {
                type: 'url',
              },
              cover: {
                type: 'url',
              },
            },
          },
          video: {
            type: 'record',
            values: {
              type: 'object',
              properties: {
                hls: {
                  type: 'url',
                },
                mp4: {
                  type: 'url',
                },
              },
            },
          },
          authors: {
            type: 'set',
            items: { type: 'string' },
          },
          floats: {
            type: 'set',
            items: { type: 'float' },
          },
          integers: {
            type: 'set',
            items: { type: 'int' },
          },
          updatedAt: {
            type: 'timestamp',
          },
        },
      },
      team: {
        prefix: 'te',
      },
      competition: {
        prefix: 'co',
      },
      camera: {
        prefix: 'ca',
      }
    }
  })
  await client.destroy()
})

test.after(async (t) => {
  const client = connect({ port })
  const d = Date.now()
  await client.delete('root')
  console.log('removed', Date.now() - d, 'ms')
  await client.destroy()
  await srv.destroy()
  await t.connectionsAreEmpty()
})

test.serial('updatedAt only changes when actually changed', async (t) => {
  const client = connect({ port }, { loglevel: 'info' })

  const team1 = await client.set({
    type: 'team',
    $alias: 'myteam1',
    name: 'team1',
  })

  const team2 = await client.set({
    type: 'team',
    $alias: 'myteam2',
    name: 'team2',
  })

  const competition = await client.set({
    type: 'competition',
    $alias: 'mycompetition',
    name: 'competition',
  })

  const cam1 = await client.set({
    type: 'camera',
  })

  let n = 2
  let lastUpdatedAt

  while (n--) {
    console.log('stonk start')
    await client.set({
      type: 'match',
      $alias: 'snurkle',
      $language: 'en',
      published: true,
      title: 'success',
      homeTeam: team1,
      awayTeam: team2,
      image: {
        thumb: 'https://example.com',
        cover: 'https://example.com',
      },
      video: {
        default: {
          hls: 'https://example.com',
          mp4: 'https://example.com',
        },
      },
      authors: ['leif', 'rolf'],
      floats: [1.5, 2.5],
      integers: [1, 2],
      parents: {
        $add: [team1, team2, competition],
      },
      children: {
        $value: [cam1],
      },
    })
    console.log('stonk end')
    const { updatedAt } = await client.get({
      $alias: 'snurkle',
      updatedAt: true,
    })

    if (lastUpdatedAt) {
      t.is(lastUpdatedAt, updatedAt)
    }

    lastUpdatedAt = updatedAt

    await wait(1)
  }

  await client.delete('root')
  await client.destroy()
})
