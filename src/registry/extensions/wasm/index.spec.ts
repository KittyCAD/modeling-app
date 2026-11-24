import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import {
  provideWasmPromise,
  wasmPromiseFacet,
} from '@src/registry/contracts/wasm'
import wasmRegistryItem from '@src/registry/extensions/wasm'
import { Registry } from 'plankton'
import { afterEach, describe, expect, it } from 'vitest'

describe('wasm extension', () => {
  let registry: Registry | undefined
  afterEach(async () => {
    await registry?.dispose()
    registry = undefined
  })
  it('lets a registry contribution override the default wasm promise', async () => {
    const wasmPromise = Promise.resolve({} as ModuleType)
    registry = new Registry()
    await registry.configure([
      [provideWasmPromise(() => wasmPromise)],
      wasmRegistryItem,
    ])

    expect(registry.get(wasmPromiseFacet)).toBe(wasmPromise)
    // This asserts registry contributions, not Testing Library's DOM debug output.
    // eslint-disable-next-line testing-library/no-debugging-utils
    expect(registry.debug(wasmPromiseFacet).value).toHaveLength(1)
  })
})
