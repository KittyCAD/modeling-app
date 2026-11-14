import { Registry } from '@kittycad/registry'
import library from '@src/lib/cloudProjects/registry/library'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  getDefaultProjectLibrarySettings,
  projectLibrariesFromSettings,
} from '@src/lib/projectLibraries'
import {
  projectLibrarySettingDefaultPoliciesValueSpec,
  projectLibraryTypesValueSpec,
} from '@src/registry/contracts/projectLibraries'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/wasm_lib_wrapper', () => ({}))

describe('cloud project library availability', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    vi.unstubAllEnvs()
  })

  it.each([
    { token: 'localhost', cloudAvailable: false },
    { token: 'real-api-token', cloudAvailable: true },
  ])(
    'offers cloud projects with $token: $cloudAvailable',
    ({ token, cloudAvailable }) => {
      vi.stubEnv('VITE_ZOO_API_TOKEN', token)
      expect(
        projectLibrariesFromSettings(
          getDefaultProjectLibrarySettings('/projects'),
          { includeCloud: cloudAvailable }
        ).some((library) => library.type === CLOUD_PROJECT_LIBRARY_TYPE)
      ).toBe(cloudAvailable)
      registry = new Registry()
      registry.configure([library])

      expect(
        registry
          .get(projectLibraryTypesValueSpec)
          .has(CLOUD_PROJECT_LIBRARY_TYPE)
      ).toBe(cloudAvailable)
      expect(
        registry
          .get(projectLibrarySettingDefaultPoliciesValueSpec)
          .some((policy) => policy.id === 'cloud-projects.defaults')
      ).toBe(cloudAvailable)
    }
  )
})
