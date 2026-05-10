import { expect } from 'vitest'
import fetch from 'node-fetch'

// Make 'expect' and 'fetch' available globally for @testing-library/jest-dom
// @ts-ignore
global.expect = expect
// @ts-ignore
globalThis.expect = expect
// @ts-ignore
globalThis.fetch = fetch

if (
  typeof globalThis.localStorage === 'undefined' ||
  typeof globalThis.localStorage.getItem !== 'function'
) {
  const values = new Map<string, string>()

  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      get length() {
        return values.size
      },
      clear() {
        values.clear()
      },
      getItem(key: string) {
        return values.get(key) ?? null
      },
      key(index: number) {
        return Array.from(values.keys())[index] ?? null
      },
      removeItem(key: string) {
        values.delete(key)
      },
      setItem(key: string, value: string) {
        values.set(key, value)
      },
    },
    configurable: true,
  })
}
