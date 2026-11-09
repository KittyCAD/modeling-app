import { kclSceneViewExtensionsValueSpec } from '@src/lib/kcl/registry/contract'
import {
  modelingToolsService,
  modelingToolsValueSpec,
} from '@src/lib/modelingTools/registry/contract'
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
    expect(
      registry
        .get(kclSceneViewExtensionsValueSpec)
        .some((extension) => extension.id === 'modeling-tools.toolbar')
    ).toBe(true)
    expect(
      registry
        .get(modelingToolsValueSpec)
        .find((tool) => tool.id === command?.id)?.command
    ).toMatchObject({ name: 'Extrude', groupId: 'kcl-modeling' })
    expect(registry.get(modelingToolsService).targets.value).toHaveLength(0)
  } finally {
    registry[Symbol.dispose]()
  }
})
