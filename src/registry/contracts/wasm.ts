import { defineContract, firstWinsValueSpec, provide } from '@kittycad/registry'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export const wasmContract = defineContract({
  wasmPromiseValueSpec: firstWinsValueSpec<Promise<ModuleType> | undefined>(
    'wasm-promise',
    undefined
  ),
})

export const { wasmPromiseValueSpec } = wasmContract

export function provideWasmPromise(wasmPromise: Promise<ModuleType>) {
  return provide(wasmPromiseValueSpec, wasmPromise, { key: 'wasm-promise' })
}
