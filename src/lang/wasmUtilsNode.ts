import { init, reloadModule } from '@src/lib/wasm_lib_wrapper'
import fs from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'

export const wasmUrlNode = () => {
  // Get the wasm module from public/kcl_wasm_lib_bg.wasm
  const localPath = path.join(
    __dirname,
    '..',
    '..',
    'public',
    'kcl_wasm_lib_bg.wasm'
  )
  // Check if the file exists.
  if (fs.existsSync(localPath)) {
    console.log('Found local wasm file', localPath)
    return localPath
  }

  // We are in production and I think the file is right next to the compiled
  // js file.
  return path.join(__dirname, 'kcl_wasm_lib_bg.wasm')
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
