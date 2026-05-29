import fetch from 'node-fetch'
import { expect } from 'vitest'

// Make 'expect' and 'fetch' available globally for @testing-library/jest-dom
// @ts-ignore
global.expect = expect
// @ts-ignore
globalThis.expect = expect
// @ts-ignore
globalThis.fetch = fetch
