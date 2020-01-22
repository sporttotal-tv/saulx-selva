import { Id } from '../schema'

export type Inherit =
  | boolean
  | {
      $type?: string | string[]
      $name?: string | string[]
      $item?: Id | Id[]
    }

export type Find = {
  $traverse?: 'descendants' | 'ancestors' | 'children' | 'parents'
}

export type List = {
  $range?: [number, number]
  $find?: Find
}

export type GetField<T> = {
  $field?: string | string[]
  $inherit?: Inherit
  $list?: List
  $default?: T
}

// want with $ come on :D
export type Item = {
  [key: string]: any
}

// update $language for default + text (algebraic)
export type GetItem<T = Item> = {
  [P in keyof T]?: T[P] extends Item[]
    ? GetItem<T>[] | true
    : T[P] extends object
    ? (GetItem<T[P]> & GetField<T>) | true
    : T[P] extends number
    ? T[P] | GetField<T[P]> | true
    : T[P] extends string
    ? T[P] | GetField<T[P]> | true
    : T[P] extends boolean
    ? T[P] | GetField<T[P]>
    : (T[P] & GetField<T[P]>) | true
} &
  GetField<T> & {
    [key: string]: any
  }

export type GetResult = {
  [key: string]: any
}
