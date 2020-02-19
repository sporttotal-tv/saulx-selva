import {
  isArray,
  joinAny,
  joinString,
  splitString,
  escapeSpecial
} from '../../util'
import { FilterAST, Fork, Value } from './types'
import { isFork } from './util'
import * as logger from '../../logger'

const returnNumber = (filter, value: Value): string => {
  if (filter.$operator === '>') {
    return `(@${filter.$field}:[${tostring(value)},inf])`
  } else if (filter.$operator === '<') {
    return `(@${filter.$field}:[-inf,${tostring(value)}])`
  } else if (filter.$operator === '..') {
    return `(@${filter.$field}:[${tostring(value[0])},${tostring(value[1])}])`
  } else if (filter.$operator === '!=') {
    return `(-(@${filter.$field}:[${tostring(value)},${tostring(value)}]))`
  } else if (filter.$operator === '=') {
    return `(@${filter.$field}:[${tostring(value)},${tostring(value)}])`
  }
  return ''
}

const addField = (
  filter: FilterAST,
  language: string = 'en'
): string | string[] => {
  // depends on field type
  const type = filter.$search && filter.$search[0]
  const operator = filter.$operator

  if (operator === 'exists') {
    return `@_exists_${filter.$field}:{T}`
  }

  if (type === 'TAG') {
    if (isArray(filter.$value)) {
      filter.$value = `${joinAny(filter.$value, '|')}`
    }
    if (operator === '!=') {
      return `(-(@${filter.$field}:{${filter.$value}}))`
    } else if (operator === '=') {
      return `(@${filter.$field}:{${filter.$value}})`
    }
  } else if (type === 'NUMERIC') {
    if (isArray(filter.$value) && filter.$operator !== '..') {
      let value = ''
      for (let i = 0, len = filter.$value.length; i < len; i++) {
        const v = returnNumber(filter, filter.$value[i])
        value += value !== '' ? '|' + v : v
      }
      return `(${value})`
    } else {
      return returnNumber(filter, filter.$value)
    }
  } else if (type === 'TEXT-LANGUAGE') {
    if (filter.$operator === '=') {
      if (isArray(filter.$value)) {
        filter.$value = `${joinAny(filter.$value, ' ')}`
      }

      return `(@___escaped\\:${filter.$field}\\.${language}:(${filter.$value}))`
    }
  } else if (type === 'TEXT-LANGUAGE-SUG') {
    if (filter.$operator === '=') {
      let words: string[] = []
      if (!isArray(filter.$value)) {
        // filter.$value = `${joinAny(filter.$value, ' ')}`
        words = splitString(escapeSpecial(tostring(filter.$value)), ' ')
      } else {
        for (let i = 0; i < filter.$value.length; i++) {
          words[i] = escapeSpecial(tostring(filter.$value[i]))
        }
      }

      let suggestions: string[] = []
      for (let i = 0; i < words.length; i++) {
        logger.info('sugget', words[i])
        const suggestion: string[] = redis.pcall(
          'ft.sugget',
          `sug_${language}`,
          words[i],
          'MAX',
          '20'
        )
        logger.info('sugget', suggestion)

        for (let j = 0; j < suggestion.length; j++) {
          suggestions[suggestions.length] = suggestion[j]
        }
      }

      if (suggestions.length > 0) {
        let searchStrs: string[] = []
        for (let i = 0; i < suggestions.length; i++) {
          const suggestion = suggestions[i]

          searchStrs[
            i
          ] = `(@___escaped\\:${filter.$field}\\.${language}:(${suggestion}))`
        }

        return searchStrs
      }

      return `(@${filter.$field}\\.${language}:(${filter.$value}))`
    }
  } else if (type === 'GEO') {
    if (filter.$operator === 'distance' && isArray(filter.$value)) {
      const [lon, lat, distance, units] = filter.$value
      return `@${filter.$field}:[${lon} ${lat} ${distance} ${units}]`
    }
  }
  return ''
}

function createSearchString(
  filters: Fork,
  language?: string
): [string[], string | null] {
  const searchString: (string | string[])[] = []
  if (filters.$and) {
    for (let filter of filters.$and) {
      if (!isFork(filter)) {
        if (filter.$field !== 'id') {
          searchString[searchString.length] = addField(filter, language)
        }
      } else {
        const [nestedSearch, err] = createSearchString(filter)
        if (err) {
          return [[], err]
        }
        searchString[searchString.length] = nestedSearch[0]
      }
    }

    let results: string[] = ['(']
    let hasArrayComponent = false
    for (let i = 0; i < searchString.length; i++) {
      const component = searchString[i]

      if (isArray(component)) {
        if (hasArrayComponent) {
          return [[], 'Only one suggestion index allowed per query']
        }

        hasArrayComponent = true
        const before = results[0]
        for (let j = 0; j < component.length; j++) {
          if (!results[j]) {
            results[j] = before
          }

          results[j] =
            results[j] +
            component[j] +
            (i === searchString.length - 1 ? ')' : ' ')
        }
      } else {
        for (let j = 0; j < results.length; j++) {
          results[j] =
            results[j] +
            searchString[i] +
            (i === searchString.length - 1 ? ')' : ' ')
        }
      }
    }

    return [results, null]
  } else if (filters.$or) {
    for (let filter of filters.$or) {
      if (isFork(filter) && filter.$or) {
        const [nestedSearch, err] = createSearchString(filter)
        if (err) {
          return [[], err]
        }
        searchString[searchString.length] = nestedSearch[0]
      } else if (!isFork(filter)) {
        if (filter.$field !== 'id') {
          searchString[searchString.length] = addField(filter, language)
        }
      } else {
        const [nestedSearch, err] = createSearchString(filter)
        if (err) {
          return [[], err]
        }
        searchString[searchString.length] = nestedSearch[0]
      }
    }

    let hasArrayComponent = false
    let results: string[] = ['(']
    for (let i = 0; i < searchString.length; i++) {
      const component = searchString[i]

      if (isArray(component)) {
        if (hasArrayComponent) {
          return [[], 'Only one suggestion index allowed per query']
        }
        hasArrayComponent = true

        const before = results[0]
        for (let j = 0; j < component.length; j++) {
          if (!results[j]) {
            results[j] = before
          }

          results[j] =
            results[j] +
            component[j] +
            (i === searchString.length - 1 ? ')' : '|')
        }
      } else {
        for (let j = 0; j < results.length; j++) {
          results[j] =
            results[j] +
            searchString[i] +
            (i === searchString.length - 1 ? ')' : '|')
        }
      }
    }

    return [results, null]
  }
  return [[], 'No valid cases for createSearchString']
}

export default createSearchString
