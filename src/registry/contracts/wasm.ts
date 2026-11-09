import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { contract, contribute, Facet, type Source } from 'plankton'
export const wasmContract = contract({
  wasmPromiseFacet: new Facet<
    Promise<ModuleType> | undefined,
    Promise<ModuleType> | undefined
  >('wasm-promise', (inputs) => (inputs.length ? inputs[0] : undefined)),
})

export const { wasmPromiseFacet } = wasmContract
export function provideWasmPromise(wasmPromise: Source<Promise<ModuleType>>) {
  return contribute(wasmPromiseFacet, wasmPromise, {
    key: 'wasm-promise',
  })
}
