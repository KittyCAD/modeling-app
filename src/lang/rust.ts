import { isTauri } from '../lib/isTauri'
import init from '../wasm-lib/pkg/wasm_lib'

const url =
  typeof window === 'undefined'
    ? 'http://localhost:3000'
    : isTauri()
    ? 'tauri://localhost'
    : 'http://localhost:3000'
const fullUrl = url + '/wasm_lib_bg.wasm'
export const initPromise = init(fullUrl)
