import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { createSettingsPersistence } from '@src/registry/extensions/settings/persistence'
import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadAndValidateSettings: vi.fn(),
}))

vi.mock('@src/lib/settings/settingsUtils', () => ({
  loadAndValidateSettings: mocks.loadAndValidateSettings,
}))

describe('settings persistence', () => {
  test('loads project settings with capability-owned contributions', async () => {
    const fileOperations = {} as never
    const wasmInstance = {} as ModuleType
    const defaultProjectLibraries = [] as const
    const projectLibrarySettingDefaultPolicies = [] as const
    const extensionSettings = {}
    const loaded = { settings: { app: {} }, configuration: {} }
    mocks.loadAndValidateSettings.mockResolvedValue(loaded)
    const loadOrCreate = createSettingsPersistence({
      fileOperations,
      wasmInstancePromise: Promise.resolve(wasmInstance),
      defaultProjectLibraries,
      projectLibrarySettingDefaultPolicies,
      extensionSettings,
    })

    await expect(loadOrCreate('/projects/bracket')).resolves.toBe(loaded)
    expect(mocks.loadAndValidateSettings).toHaveBeenCalledWith(
      fileOperations,
      wasmInstance,
      {
        defaultProjectLibraries,
        projectLibrarySettingDefaultPolicies,
        extensionSettings,
        projectPath: '/projects/bracket',
      }
    )
  })
})
