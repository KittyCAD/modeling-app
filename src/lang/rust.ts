import init from '../wasm-lib/pkg/wasm_lib'

const initialise = async () => {
  const baseUrl =
    typeof window === 'undefined'
      ? 'http://127.0.0.1:3000'
      : window.location.origin.includes('tauri://localhost')
      ? 'tauri://localhost'
      : window.location.origin.includes('localhost')
      ? 'http://localhost:3000'
      : window.location.origin && window.location.origin !== 'null'
      ? window.location.origin
      : 'http://localhost:3000'
  const fullUrl = baseUrl + '/wasm_lib_bg.wasm'
  const input = await fetch(fullUrl)
  const buffer = await input.arrayBuffer()
  return init(buffer)
}

export const initPromise = initialise()
