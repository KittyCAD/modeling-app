import { computed, signal } from '@preact/signals'
import { booleanSetting } from '@src/contracts/settings'
import { installCloudLibraryActivationPolicy } from '@src/features/cloudSync/cloudLibraryActivationPolicy'
import {
  CLOUD_LIBRARY_TYPE,
  type ProjectLibrary,
} from '@src/lib/projectLibraries'
import { describe, expect, it, vi } from 'vitest'

const activationSetting = booleanSetting({
  id: 'plugins.cloudSync',
  section: 'plugins',
  title: 'Cloud sync',
  defaultValue: false,
  toml: ['settings', 'plugins', 'cloud_sync'],
})

const cloudLibrary: ProjectLibrary = {
  id: 'cloud',
  order: 0,
  title: 'Personal Cloud',
  path: '/cloud',
  type: CLOUD_LIBRARY_TYPE,
}

describe('Cloud library activation policy', () => {
  it('turns off the desktop plugin when its materialized library is removed', () => {
    const configured = signal<readonly ProjectLibrary[]>([cloudLibrary])
    const set = vi.fn()
    const addLibrary = vi.fn(() => {
      configured.value = [cloudLibrary]
      return cloudLibrary
    })
    const dispose = installCloudLibraryActivationPolicy({
      libraries: {
        libraries: computed(() => configured.value),
        type: () => ({
          type: CLOUD_LIBRARY_TYPE,
          title: 'Cloud',
          icon: 'cloud',
          description: 'Cloud.',
          locationLabel: 'Local storage',
          newLibrarySetting: () => cloudLibrary,
        }),
        addLibrary,
      },
      fileSystem: {
        defaultRoot: computed(() => '/projects'),
        defaultCloudRoot: computed(() => '/cloud'),
      },
      runtime: {
        info: computed(() => ({
          target: 'desktop' as const,
          isDesktop: true,
          isWeb: false,
          isTest: true,
          version: 'test',
        })),
      },
      auth: { status: computed(() => 'signedIn' as const) },
      settings: { set },
      activationSetting,
    })

    configured.value = []

    expect(set).toHaveBeenCalledWith(activationSetting, 'user', false)
    expect(addLibrary).not.toHaveBeenCalled()
    dispose()
  })
})
