import init from '../wasm-lib/pkg/wasm_lib'

const url =
  typeof window === 'undefined'
    ? 'http://localhost:3000'
    : window.location.origin.includes('localhost')
    ? 'http://localhost:3000'
    : window.location.origin
export const initPromise = init(url + '/wasm/wasm_lib_bg.wasm')
