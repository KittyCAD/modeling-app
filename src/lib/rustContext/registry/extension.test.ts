import {
  defineRegistryItem,
  provideService,
  Registry,
} from '@kittycad/registry'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { engineConnectionService } from '@src/lib/engineConnection/registry/contract'
import RustContext from '@src/lib/rustContext'
import rustContextRegistryItem from '@src/lib/rustContext/registry'
import { rustContextService } from '@src/lib/rustContext/registry/contract'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsService } from '@src/registry/contracts/settings'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import { afterEach, describe, expect, it } from 'vitest'

describe('rust context extension', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
  })

  it('provides a RustContext instance through the registry', () => {
    const wasmPromise = new Promise<ModuleType>(() => {})
    const settings = {
      actor: {},
    } as SettingsRegistryService
    const engineConnection = {
      manager: {},
    } as { manager: ConnectionManager }

    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-rust-context-dependencies',
        provides: [provideWasmPromise(wasmPromise)],
        providesServices: [
          provideService(settingsService, settings),
          provideService(engineConnectionService, engineConnection),
        ],
      }),
      rustContextRegistryItem,
    ])

    const context = registry.get(rustContextService).context

    expect(context).toBeInstanceOf(RustContext)
    expect(context.wasmInstancePromise).toBe(wasmPromise)
    expect(context.settingsActor).toBe(settings.actor)
  })
})
