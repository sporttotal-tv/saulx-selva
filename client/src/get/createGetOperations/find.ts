import { Find, GetOperation, GetOptions, Sort } from '../types'
import { createAst } from '@saulx/selva-query-ast-parser'
import { padId } from '../utils'

const createFindOperation = (
  find: Find,
  props: GetOptions,
  id: string,
  field: string,
  single: boolean,
  limit: number = single ? 1 : -1,
  offset: number = 0,
  sort?: Sort | Sort[]
): GetOperation => {
  const findOperation: GetOperation = {
    type: 'find',
    id: padId(id),
    props,
    single,
    field: field.substr(1),
    sourceField: field.substr(1),
    options: {
      limit,
      offset,
      sort: Array.isArray(sort) ? sort[0] : sort || undefined
    }
  }

  if (find.$traverse) {
    if (typeof find.$traverse === 'string') {
      findOperation.sourceField = find.$traverse
    } else if (Array.isArray(find.$traverse)) {
      findOperation.inKeys = find.$traverse
    }
  }

  if (find.$filter) {
    const ast = createAst(find.$filter)
    if (ast) {
      findOperation.filter = ast
    }
  }

  if (find.$find) {
    findOperation.options.limit = -1
    findOperation.options.offset = 0
    if (find.$filter || sort) {
      // only remove is this is nessecary
      findOperation.single = false
    }
    findOperation.nested = createFindOperation(
      find.$find,
      props,
      '',
      field,
      single,
      limit,
      offset,
      sort
    )
  }

  return findOperation
}

export default createFindOperation
