import { SelvaClient } from '../../'
import { GetOperationFind, GetResult, GetOperation, GetOptions } from '../types'
import { typeCast } from './'
import { ast2rpn, Fork, FilterAST, isFork } from '@saulx/selva-query-ast-parser'
import { executeNestedGetOperations, ExecContext, addMarker } from './'
import { padId, joinIds, getNestedSchema } from '../utils'
import { setNestedResult } from '../utils'

function parseGetOpts(
  props: GetOptions,
  path: string
): [Set<string>, GetOptions[]] {
  const pathPrefix = path === '' ? '' : path + '.'
  const fields: Set<string> = new Set()

  const gets: GetOptions[] = []
  for (const k in props) {
    if (props[k] === true) {
      fields.add(pathPrefix + k)
    } else if (props[k] === false) {
      // ignore
    } else if (typeof props[k] === 'object') {
      const opts = Object.keys(props[k]).filter(p => p.startsWith('$'))
      if ((path === '' || opts.length === 1) && opts[0] === '$field') {
        for (const f in props[k].$field) {
          fields.add(f)
        }
      } else if (path !== '' && opts.length >= 1) {
        const o = {}
        setNestedResult(o, pathPrefix + k, props[k])
        gets.push(o)
      } else if (!k.startsWith('$')) {
        const [nestedFields, nestedGets] = parseGetOpts(
          props[k],
          pathPrefix + k
        )

        for (const f of nestedFields.values()) {
          fields.add(f)
        }

        gets.push(...nestedGets)
      }
    }
  }

  return [fields, gets]
}

function findTimebased(ast: Fork): FilterAST[] {
  if (!ast) {
    return []
  }

  const parse = (fork: Fork, filters: FilterAST[]) => {
    if (fork.$and) {
      for (const f of fork.$and) {
        if (isFork(f)) {
          parse(f, filters)
        } else if (f.hasNow) {
          filters.push(f)
        }
      }
    } else if (fork.$or) {
      for (const f of fork.$or) {
        if (isFork(f)) {
          parse(f, filters)
        } else if (f.hasNow) {
          filters.push(f)
        }
      }
    }
  }

  const res = []
  parse(ast, res)
  return res
}

function excludeTimebased(ast: Fork | FilterAST): Fork | FilterAST {
  if (!isFork(ast)) {
    return ast
  }

  const newFork = Object.assign({}, ast)
  const filters = []
  if (ast.$or) {
    for (const f of ast.$or) {
      if (isFork(f)) {
        const n = excludeTimebased(f)
        if (n) {
          filters.push(n)
        }
      } else if (!f.hasNow) {
        filters.push(f)
      }
    }

    newFork.$or = filters
  } else if (ast.$and) {
    for (const f of ast.$and) {
      if (isFork(f)) {
        const n = excludeTimebased(f)
        if (n) {
          filters.push(n)
        }
      } else if (!f.hasNow) {
        filters.push(f)
      }
    }

    newFork.$and = filters
  }

  if (!filters.length) {
    return null
  }

  return newFork
}

async function checkForNextRefresh(
  ctx: ExecContext,
  client: SelvaClient,
  sourceField: string,
  paddedIds: string,
  ast: Fork,
  lang?: string
): Promise<void> {
  if (!ctx.subId) {
    return
  }

  const uniq = new Set()
  const timebased = findTimebased(ast).filter(f => {
    if (uniq.has(f.$field)) {
      return false
    }

    uniq.add(f.$field)
    return true
  })

  if (!timebased.length) {
    return
  }

  const withoutTimebased = excludeTimebased(ast)
  await Promise.all(
    timebased.map(async f => {
      const newFilter = Object.assign({}, f)
      newFilter.$operator = '>'

      let newFork: Fork = {
        isFork: true,
        $and: [withoutTimebased, newFilter]
      }

      if (!withoutTimebased) {
        newFork.$and = [newFilter]
      }

      const args = ast2rpn(newFork, lang)
      const ids = await client.redis.selva_hierarchy_find(
        {
          name: ctx.db
        },
        '___selva_hierarchy',
        'bfs',
        sourceField,
        'order',
        f.$field,
        'asc',
        'offset',
        0,
        'limit',
        1,
        paddedIds,
        ...args
      )

      if (!ids || !ids.length) {
        return
      }

      const [id] = ids

      const time = Number(
        await client.redis.selva_object_get({ name: ctx.db }, id, f.$field)
      )

      if (!ctx.meta.___refreshAt || ctx.meta.___refreshAt > time) {
        ctx.meta.___refreshAt = time
      }
    })
  )
}

const findIds = async (
  client: SelvaClient,
  op: GetOperationFind,
  lang: string,
  ctx: ExecContext
): Promise<string[]> => {
  const { db, subId } = ctx

  let sourceField: string = <string>op.sourceField
  if (typeof op.props.$list === 'object' && op.props.$list.$inherit) {
    const res = await executeNestedGetOperations(
      client,
      {
        $db: ctx.db,
        $id: op.id,
        result: {
          $field: op.sourceField,
          $inherit: op.props.$list.$inherit
        }
      },
      lang,
      ctx
    )

    op.inKeys = res.result
  } else if (Array.isArray(op.sourceField)) {
    sourceField = op.sourceField.join('\n')
  }
  const args = op.filter ? ast2rpn(op.filter, lang) : ['#1']
  // TODO: change this if ctx.subId (for markers)
  if (op.inKeys) {
    // can make this a bit better....
    const ids = await client.redis.selva_hierarchy_findin(
      {
        name: db
      },
      '___selva_hierarchy',
      'order',
      op.options.sort?.$field || '',
      op.options.sort?.$order || 'asc',
      'offset',
      op.options.offset,
      'limit',
      op.options.limit,
      joinIds(op.inKeys),
      ...args
    )

    await checkForNextRefresh(
      ctx,
      client,
      sourceField,
      joinIds(op.inKeys),
      op.filter,
      lang
    )

    return ids
  } else {
    const realOpts: any = {}
    for (const key in op.props) {
      if (!key.startsWith('$')) {
        realOpts[key] = true
      }
    }

    if (op.nested) {
      let added = false
      for (let i = 0; i < op.id.length; i += 10) {
        let endLen = 10
        while (op.id[i + endLen - 1] === '\0') {
          endLen--
        }
        const id = op.id.slice(i, endLen)

        const r = await addMarker(client, ctx, {
          type: sourceField,
          id: id,
          fields: op.props.$all === true ? [] : Object.keys(realOpts),
          rpn: args
        })

        added = added || r

        await checkForNextRefresh(ctx, client, sourceField, id, op.filter, lang)
      }

      if (added) {
        ctx.hasFindMarkers = true
      }
    } else {
      const added = await addMarker(client, ctx, {
        type: sourceField,
        id: op.id,
        fields: op.props.$all === true ? [] : Object.keys(realOpts),
        rpn: args
      })

      if (added) {
        ctx.hasFindMarkers = true
      }
    }

    const ids = await client.redis.selva_hierarchy_find(
      {
        name: db
      },
      '___selva_hierarchy',
      'bfs',
      sourceField,
      'order',
      op.options.sort?.$field || '',
      op.options.sort?.$order || 'asc',
      'offset',
      op.options.offset,
      'limit',
      op.options.limit,
      padId(op.id),
      ...args
    )

    await checkForNextRefresh(
      ctx,
      client,
      sourceField,
      padId(op.id),
      op.filter,
      lang
    )

    return ids
  }
}

const findFields = async (
  client: SelvaClient,
  op: GetOperationFind,
  lang: string,
  ctx: ExecContext
): Promise<string[]> => {
  const { db, subId } = ctx

  let sourceField: string = <string>op.sourceField
  if (typeof op.props.$list === 'object' && op.props.$list.$inherit) {
    const res = await executeNestedGetOperations(
      client,
      {
        $db: ctx.db,
        $id: op.id,
        result: {
          $field: op.sourceField,
          $inherit: op.props.$list.$inherit
        }
      },
      lang,
      ctx
    )

    op.inKeys = res.result
  } else if (Array.isArray(op.sourceField)) {
    sourceField = op.sourceField.join('\n')
  }

  // TODO: parse the props into 'fields' arg and "leftover gets"
  const [fieldsOpt, additionalGets] = parseGetOpts(op.props, '')

  const args = op.filter ? ast2rpn(op.filter, lang) : ['#1']
  if (op.inKeys) {
    // TODO: additionalGets

    const result = await client.redis.selva_hierarchy_findin(
      {
        name: db
      },
      '___selva_hierarchy',
      'order',
      op.options.sort?.$field || '',
      op.options.sort?.$order || 'asc',
      'offset',
      op.options.offset,
      'limit',
      op.options.limit,
      'fields',
      [...fieldsOpt.values()].join('\n'),
      joinIds(op.inKeys),
      ...args
    )

    await checkForNextRefresh(
      ctx,
      client,
      sourceField,
      joinIds(op.inKeys),
      op.filter,
      lang
    )

    return result
  } else {
    const realOpts: any = {}
    for (const key in op.props) {
      if (!key.startsWith('$')) {
        realOpts[key] = true
      }
    }

    if (op.nested) {
      let added = false
      for (let i = 0; i < op.id.length; i += 10) {
        let endLen = 10
        while (op.id[i + endLen - 1] === '\0') {
          endLen--
        }
        const id = op.id.slice(i, endLen)

        const r = await addMarker(client, ctx, {
          type: sourceField,
          id: id,
          fields: op.props.$all === true ? [] : Object.keys(realOpts),
          rpn: args
        })

        added = added || r

        await checkForNextRefresh(ctx, client, sourceField, id, op.filter, lang)
      }

      if (added) {
        ctx.hasFindMarkers = true
      }
    } else {
      const added = await addMarker(client, ctx, {
        type: sourceField,
        id: op.id,
        fields: op.props.$all === true ? [] : Object.keys(realOpts),
        rpn: args
      })

      if (added) {
        ctx.hasFindMarkers = true
      }
    }

    const result = await client.redis.selva_hierarchy_find(
      {
        name: db
      },
      '___selva_hierarchy',
      'bfs',
      sourceField,
      'order',
      op.options.sort?.$field || '',
      op.options.sort?.$order || 'asc',
      'offset',
      op.options.offset,
      'limit',
      op.options.limit,
      'fields',
      [...fieldsOpt.values()].join('\n'),
      padId(op.id),
      ...args
    )

    await checkForNextRefresh(
      ctx,
      client,
      sourceField,
      padId(op.id),
      op.filter,
      lang
    )

    return result
  }
}

const executeFindOperation = async (
  client: SelvaClient,
  op: GetOperationFind,
  lang: string,
  ctx: ExecContext
): Promise<GetResult> => {
  const schema = client.schemas[ctx.db]

  if (op.nested) {
    let nestedOperation = op.nested
    let ids

    do {
      ids = await findIds(
        client,
        Object.assign({}, nestedOperation, {
          id: joinIds(ids)
        }),
        lang,
        ctx
      )

      nestedOperation = nestedOperation.nested
    } while (nestedOperation.nested)
  }

  let ids = await findIds(client, op, lang, ctx)

  if (op.nested) {
    let nestedOperation = op.nested
    let prevIds = ids
    while (nestedOperation) {
      ids = await findIds(
        client,
        Object.assign({}, nestedOperation, {
          id: joinIds(ids)
        }),
        lang,
        ctx
      )
      prevIds = ids
      nestedOperation = nestedOperation.nested
    }
  }

  // console.log('FIND FIELDS', await findFields(client, op, lang, ctx))

  let results: any = await findFields(client, op, lang, ctx)

  if (op.single) {
    results = [results[0]]
  }

  const result = []
  for (let entry of results) {
    const [id, fieldResults] = entry
    const entryRes = {}
    for (let i = 0; i < fieldResults.length; i += 2) {
      const field = fieldResults[i]
      const value = fieldResults[i + 1]

      setNestedResult(entryRes, field, typeCast(value, id, field, schema, lang))
    }

    result.push(entryRes)
  }

  if (op.single) {
    return result[0]
  }

  return result
}

export default executeFindOperation
