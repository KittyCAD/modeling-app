import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { engineConnectionService } from '@src/lib/engineConnection/registry/contract'
import RustContext from '@src/lib/rustContext'
import { createRustContextExtension } from '@src/lib/rustContext/registry/extension'
import { rustContextService } from '@src/lib/rustContext/registry/contract'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsService } from '@src/registry/contracts/settings'
import { provideWasmPromise } from '@src/registry/contracts/wasm'
import { factory, provide, Registry } from 'plankton'
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
        provide(settingsService, { actor: {} } as SettingsRegistryService),
        provide(engineConnectionService, engineConnection),
      ],
      createRustContextExtension({
        settings: factory({ create: () => ({ exports: settings }) }),
        engineConnection: factory({
          create: () => ({ exports: engineConnection }),
        }),
      }),
    ])
    const context = registry.required(rustContextService).context
    expect(context).toBeInstanceOf(RustContext)
    expect(context.wasmInstancePromise).toBe(wasmPromise)
    expect(context.settingsActor).toBe(settings.actor)
  })
})
