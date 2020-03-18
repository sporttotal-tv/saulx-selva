# Selva

## About

🌴 Selva is a realtime undirected acyclic graph database.

It was built to handle massively scalable data structures with complex hierarchies and taxonomies. Documents or graph vertices can have any number or combination of parents and children. Field values can be augmented with data from other members of its hierarchy allowing for useful defaults based on the document context.  
All of this with real-time updates and transparent subscriptions making it perfect to drive dynamic websites and applications.

Here are some of its features:

  - Real-time engine and subscription model.
  - Versioning system for the data itself allowing branches of data to be merged and revised into the master data, allowing content creators to try changes before date is published to a live system. It allows collaborative version editing in real-time.
  - Schemas enforce data types with builtin validation.
  - Persistence layer using GIT-LFS allowing backups every 5 mins and all versions of the data to available at all times.
  - Custom query language and indexes optimized for the undirected acyclic graph data structure.
  - Simple JSON based query language DSL.
  - Client API uses web sockets to subscribe to data and transparently keep content updated in real-time.

## Documentation

Selva is composed of two main modules - @saulx/selva client and @saulx/selva-server.
Documentation for its API as well as the two main concepts: the schemas and its query DSL can be viewed in the links below.

  - [API](docs/api.md)
  - [Schema definition](docs/schemas.md)
  - [Query language](docs/query.md)

## Usage

Setup a server.

```js
import { start } from '@saulx/selva-server'

const server = await start({ port:8080 })
```

Setup the client and load the [schema](docs/schemas.md)

```js
import { connect } from '@saulx/selva'

const client = connect({ port: 8080 })
await client.updateSchema({
  languages: ['en', 'nl'],
  types: {
    genre: {
      prefix: 'ge',
      fields: {
        name: { type: 'text' },
        icon: { type: 'string' }
      }
    },
    movie: {
      prefix: 'mo',
      fields: {
        title: { type: 'text' },
        year: { type: 'int', search: true },
        director: { type: 'string' },
        icon: { type: 'string' },
        technicalData: {
          type: 'object',
          properties: {
            runtime: { type: 'int' },
            color: { type: 'string' },
            aspectRatio: { type: 'string' }
          }
        }
      }
    },
    person: {
      prefix: 'pe',
      fields: {
        name: { type: 'string' },
        born: { type: 'int' },
        died: { type: 'int' }
      }
    }
  }
})
```

Set some data

```js
await Promise.all([
  {
    $id: 'mo2001ASpaceOdyssey',
    title: {
      en: '2001: A Space Odyssey',
      nl: '2001: Een zwerftocht in de ruimte'
    },
    year: 1968,
    director: 'Stanley Kubrick',
    technicalData: {
      runtime: 149,
      color: 'true',
      aspectRatio: '2.20:1'
    },
  },
  {
    $id: 'moSoylentGreen',
    title: {
      en: 'Soylent Green',
      nl: 'Groen Rantsoen'
    },
    year: 1973,
    director: 'Richard Fleischer',
    technicalData: {
      runtime: 97,
      color: 'true',
      aspectRatio: '2.35:1'
    },
    children: [
      'peCharltonHeston',
      'peLeighTaylorYoung',
      'peChuckConnors'
    ],
  },
  {
    $id: 'moMetropolis',
    title: { en: 'Metropolis' },
    year: 1927,
    director: 'Fritz Lang',
    technicalData: {
      runtime: 153,
      color: 'false',
      aspectRatio: '1.33:1'
    },
  }
].map(movie => client.set(movie)))
```

Query the data

```js
const result = await client.get({
  $id: 'moSoylentGreen',
  $language: 'en',
  title: true,
  year: true,
  director: true
})
```

## License

TBD
