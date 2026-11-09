import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { engineConnectionService } from '@src/lib/engineConnection/registry/contract'
import RustContext from '@src/lib/rustContext'
import rustContextRegistryItem from '@src/lib/rustContext/registry'
import { rustContextService } from '@src/lib/rustContext/registry/contract'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsService } from '@src/registry/contracts/settings'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import { provide, Registry } from 'plankton'
import { afterEach, describe, expect, it } from 'vitest'

describe('rust context extension', () => {
  let registry: Registry | undefined
  afterEach(async () => {
    await registry?.dispose()
    registry = undefined
  })
  it('provides a RustContext instance through the registry', async () => {
    const wasmPromise = new Promise<ModuleType>(() => {})
    const settings = {
      actor: {},
    } as SettingsRegistryService
    const engineConnection = {
      manager: {},
    } as {
      manager: ConnectionManager
    }
    registry = new Registry()
    await registry.configure([
      [
        provideWasmPromise(() => wasmPromise),
        provide(settingsService, settings),
        provide(engineConnectionService, engineConnection),
      ],
      rustContextRegistryItem,
    ])
    const context = registry.required(rustContextService).context
    expect(context).toBeInstanceOf(RustContext)
    expect(context.wasmInstancePromise).toBe(wasmPromise)
    expect(context.settingsActor).toBe(settings.actor)
  })
})
