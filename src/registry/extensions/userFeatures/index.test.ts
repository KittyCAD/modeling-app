import type { Feature } from '@kittycad/lib'
import { UserFeaturesState } from '@src/machines/userFeaturesMachine'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import userFeaturesRegistryItem from '@src/registry/extensions/userFeatures'
import { Registry } from 'plankton'
import { afterEach, describe, expect, it } from 'vitest'

const EXAMPLE_FEATURE = 'sketch_experimental_features' as Feature

describe('user features extension', () => {
  let registry: Registry | undefined
  afterEach(async () => {
    await registry?.dispose()
    registry = undefined
  })
  it('provides feature flag context and readiness through the registry', async () => {
    registry = new Registry()
    await registry.configure([userFeaturesRegistryItem])
    const userFeatures = registry.required(userFeaturesService)
    expect(userFeatures.state.value.matches(UserFeaturesState.Idle)).toBe(true)
    expect(userFeatures.ready.value).toBe(false)
    expect(userFeatures.context.value.featureIds.size).toBe(0)
    expect(userFeatures.has(EXAMPLE_FEATURE, false)).toBe(false)
    expect(userFeatures.has(EXAMPLE_FEATURE, true)).toBe(true)
  })
})
