import init from '../wasm-lib/pkg/wasm_lib'

const url =
  typeof window === 'undefined'
    ? 'http://127.0.0.1:3000'
    : window.location.origin.includes('localhost')
    ? 'http://127.0.0.1:3000'
    : window.location.origin
const fullUrl = url + '/wasm/wasm_lib_bg.wasm'
console.log('fullUrl', fullUrl)
export const initPromise = init(fullUrl)
