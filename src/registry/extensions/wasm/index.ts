import { initialiseWasm } from '@src/lang/wasmUtils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import { type Subtree } from 'plankton'
export const wasmExtension = {
  key: 'wasm-extension',
  create: () => {
    let wasmPromise: Promise<ModuleType> | undefined

    return {
      items: [
        provideWasmPromise(() => {
          wasmPromise ??= initialiseWasm()
          return wasmPromise
        }),
      ],
    }
  },
} satisfies Subtree
export default [wasmExtension]
