import init from '../wasm-lib/pkg/wasm_lib'

const url =
  typeof window === 'undefined'
    ? 'http://127.0.0.1:3000'
    : window.location.origin.includes('tauri://localhost')
    ? 'tauri://localhost'
    : window.location.origin.includes('localhost')
    ? 'http://127.0.0.1:3000'
    : window.location.origin
const fullUrl = url + '/wasm_lib_bg.wasm'
export const initPromise = init(fullUrl)
