import {
  executorCapabilityValueSpec,
  executorViewValueSpec,
} from '@src/lib/executors/registry/contract'
import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import {
  userFeaturesService,
  type UserFeaturesRegistryService,
} from '@src/registry/contracts/userFeatures'
import { PROJECT_SHELL_FEATURE } from '@src/lib/projectSession/next/feature'
import kclExtension from '@src/lib/kcl/registry'
import { editorCapabilityValueSpec } from '@src/lib/editors/registry/contract'
import { afterEach, expect, it } from 'vitest'

const granted = signal(false)
const featureFlags = defineRegistryItem({
  providesServices: [
    provideService(userFeaturesService, {
      has: (flag: string, fallback: boolean) =>
        flag === PROJECT_SHELL_FEATURE ? granted.value : fallback,
    } as UserFeaturesRegistryService),
  ],
})

const registry = new Registry()
afterEach(() => registry[Symbol.dispose]())

it.each([false, true])(
  'gates KCL editor and executor contributions with the project-shell flag: %s',
  async (enabled) => {
    granted.value = enabled
    registry.configure([featureFlags, kclExtension])
    registry.get(userFeaturesService)
    await Promise.resolve()
    expect(registry.get(editorCapabilityValueSpec).length > 0).toBe(enabled)
    expect(registry.get(executorCapabilityValueSpec).length > 0).toBe(enabled)
    expect(registry.get(executorViewValueSpec).length > 0).toBe(enabled)
  }
)
