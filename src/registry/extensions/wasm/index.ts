import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
} from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import { initialiseWasm } from '@src/lang/wasmUtils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { provideWasmPromise } from '@src/registry/contracts/wasm'

export const wasmExtension = defineRegistryItemFactory(() => {
  let wasmPromise: Promise<ModuleType> | undefined

  return {
    item: defineRuntimeRegistryItem({
      id: 'wasm-extension',
      provides: [
        provideWasmPromise(
          computed(() => {
            wasmPromise ??= initialiseWasm()
            return wasmPromise
          })
        ),
      ],
    }),
  }
}, 'wasm-extension')

export default defineRegistryItem({
  id: 'wasm',
  uses: [wasmExtension],
})
