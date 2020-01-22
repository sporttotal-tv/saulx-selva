declare const KEYS: string[]
declare const ARGV: string[]

declare module redis {
  function call(this: void, ...args: string[]): any
  function debug(this: void, msg: string): void
  function error_reply(this: void, errorStr: string): Error
}
