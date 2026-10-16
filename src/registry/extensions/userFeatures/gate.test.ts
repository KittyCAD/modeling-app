import {
  defineRegistryItem,
  provideService,
  Registry,
  Slot,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import featureTree from '@src/lib/featureTree/registry'
import { SCENE_BROWSER_FEATURE } from '@src/lib/sceneBrowser/featureFlag'
import sceneBrowser from '@src/lib/sceneBrowser/registry'
import {
  sceneBrowserService,
  sceneBrowserSections,
} from '@src/lib/sceneBrowser/registry/contract'
import type { UserFeature } from '@src/machines/userFeaturesMachine'
import { commandsValueSpec } from '@src/registry/contracts/commands'
import { engineSceneViewExtensionsValueSpec } from '@src/registry/contracts/engineScene'
import {
  keymapEventOwnersValueSpec,
  keymapValueSpec,
} from '@src/registry/contracts/keymap'
import {
  userFeaturesService,
  type UserFeaturesRegistryService,
} from '@src/registry/contracts/userFeatures'
import { afterEach, describe, expect, it } from 'vitest'
import { waitFor } from '@testing-library/react'

let registry: Registry | undefined
afterEach(async () => {
  await registry?.disposeAsync()
})

describe('Scene browser user feature gate', () => {
  it('stays absent without user features, follows flag updates and removes all runtime contributions on revocation', async () => {
    const featureIds = signal(new Set<UserFeature>())
    const service = {
      has: (feature: UserFeature) => featureIds.value.has(feature),
    } as unknown as UserFeaturesRegistryService
    const serviceSlot = new Slot()
    registry = new Registry()
    registry.configure([featureTree, sceneBrowser, serviceSlot.of()])
    const assertAbsent = () => {
      expect(registry!.optional(sceneBrowserService)).toBeUndefined()
      expect(registry!.get(sceneBrowserSections)).toEqual([])
      expect(registry!.get(engineSceneViewExtensionsValueSpec)).toEqual([])
      expect(registry!.get(commandsValueSpec)).toEqual([])
      expect(registry!.get(keymapValueSpec).items).toEqual([])
      expect(registry!.get(keymapEventOwnersValueSpec)).toEqual([])
    }
    assertAbsent()
    registry.reconfigure(serviceSlot, [
      defineRegistryItem({
        providesServices: [provideService(userFeaturesService, service)],
      }),
    ])
    assertAbsent()
    featureIds.value = new Set([SCENE_BROWSER_FEATURE])
    await waitFor(() =>
      expect(registry!.get(sceneBrowserSections)).toHaveLength(2)
    )
    expect(registry.get(engineSceneViewExtensionsValueSpec)).toHaveLength(1)
    expect(registry.optional(sceneBrowserService)).toBeDefined()
    expect(registry.get(commandsValueSpec)).toHaveLength(4)
    const previous = registry.get(sceneBrowserService)
    featureIds.value = new Set([SCENE_BROWSER_FEATURE])
    await Promise.resolve()
    expect(registry.get(sceneBrowserService)).toBe(previous)
    featureIds.value = new Set()
    await waitFor(assertAbsent)
    featureIds.value = new Set([SCENE_BROWSER_FEATURE])
    await waitFor(() =>
      expect(registry!.optional(sceneBrowserService)).toBeDefined()
    )
    registry.reconfigure(serviceSlot, [])
    await waitFor(assertAbsent)
  })
})
