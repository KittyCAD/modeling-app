import { Registry, defineRegistryItem } from '@kittycad/registry'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  provideWasmPromise,
  wasmPromiseValueSpec,
} from '@src/registry/contracts/wasm'
import wasmRegistryItem from '@src/registry/extensions/wasm'
import { afterEach, describe, expect, it } from 'vitest'

describe('wasm extension', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
  })

  it('lets a registry contribution override the default wasm promise', () => {
    const wasmPromise = Promise.resolve({} as ModuleType)
    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test.wasm-promise',
        provides: [provideWasmPromise(wasmPromise)],
      }),
      wasmRegistryItem,
    ])

    expect(registry.get(wasmPromiseValueSpec)).toBe(wasmPromise)
    expect(registry.debugValueSpec(wasmPromiseValueSpec).value).toHaveLength(1)
  })
})
