import '@src/lib/projectSession/next/testFeature'
import { defineRegistryItem, Registry } from '@kittycad/registry'
import kclExtension from '@src/lib/kcl/registry'
import { editorViewValueSpec } from '@src/lib/editors/registry/contract'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import { expect, it } from 'vitest'

it('registers Modeling and Extrude before WASM finishes loading', () => {
  const registry = new Registry()
  const wasmPromise = new Promise<ModuleType>(() => {})
  try {
    registry.configure([
      kclExtension,
      defineRegistryItem({ provides: [provideWasmPromise(wasmPromise)] }),
    ])
    expect(
      registry.get(editorViewValueSpec).some((view) => view.id === 'kcl.engine')
    ).toBe(true)
    const command = registry
      .get(commandsValueSpec)
      .find((entry) => entry.id === 'kcl.extrude')
    expect(command?.name).toBe('Extrude')
    expect(command?.disabled).toBe(true)
  } finally {
    registry[Symbol.dispose]()
  }
})
