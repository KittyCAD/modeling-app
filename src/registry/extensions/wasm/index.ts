import { initialiseWasm } from '@src/lang/wasmUtils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import { factory as defineFactory, type Factory } from 'plankton'
export const wasmExtension = defineFactory({
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
}) satisfies Factory
export default [wasmExtension]
