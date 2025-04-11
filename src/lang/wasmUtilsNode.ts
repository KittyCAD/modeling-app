import { init, reloadModule } from '@src/lib/wasm_lib_wrapper'
import fs from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'

export const wasmUrlNode = () => {
  // In prod the file will be right next to the compiled js file.
  const prodPath = path.join(__dirname, 'kcl_wasm_lib_bg.wasm')
  // Check if the file exists.
  if (fs.existsSync(prodPath)) {
    return prodPath
  }

  // Get the wasm module from public/kcl_wasm_lib_bg.wasm
  return path.join(__dirname, '..', '..', 'public', 'kcl_wasm_lib_bg.wasm')
}

// Initialise the wasm module.
const initialiseNode = async () => {
  try {
    await reloadModule()
    const fullPath = wasmUrlNode()
    const buffer = await fsPromises.readFile(fullPath)
    return await init({ module_or_path: buffer })
  } catch (e) {
    console.log('Error initialising WASM', e)
    return Promise.reject(e)
  }
}

export const initPromiseNode = initialiseNode()
