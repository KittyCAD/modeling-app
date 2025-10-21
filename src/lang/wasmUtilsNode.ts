import fs from 'fs'
import path from 'path'
import { init, reloadModule } from '@src/lib/wasm_lib_wrapper'
import fsPromises from 'fs/promises'
import { processEnv } from '@src/env'

export const wasmUrlNode = () => {
  // In prod the file will be right next to the compiled js file.
  const prodPath = path.join(__dirname, 'kcl_wasm_lib_bg.wasm')
  // Check if the file exists.
  if (fs.existsSync(prodPath)) {
    console.log('Found wasm file in prod', prodPath)
    return prodPath
  }

  // Get the wasm module from public/kcl_wasm_lib_bg.wasm
  console.log('Using dev wasm file')
  const devPath = path.join(
    __dirname,
    '..',
    '..',
    'public',
    'kcl_wasm_lib_bg.wasm'
  )
  console.log('Using dev wasm file', devPath)
  return devPath
}

// Initialise the wasm module.
const initialiseNode = async () => {
  if (processEnv()?.VITEST) {
    const message =
      'wasmUtilsNode is trying to call initialiseNode. This will be blocked in VITEST runtimes.'
    console.log(message)
    return Promise.resolve(message)
  }

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

/**
 * Given a path to a .wasm file read it from disk and load the module
 * then return the instance to use. Not globally shared.
 */
export const loadAndInitialiseWasmInstance = async (path: string) => {
  // Read the .wasm blob off disk
  const wasmBuffer = await fsPromises.readFile(path)
  // get an instance of the wasm lib loader
  const instanceOfWasmLibImport = await import(
    `@rust/kcl-wasm-lib/pkg/kcl_wasm_lib`
  )
  // Tell the instance to load the was buffer
  await instanceOfWasmLibImport.default({ module_or_path: wasmBuffer })
  return instanceOfWasmLibImport
}
