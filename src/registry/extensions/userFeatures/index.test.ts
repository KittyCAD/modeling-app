import { Registry } from '@kittycad/registry'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'
import { UserFeaturesState } from '@src/machines/userFeaturesMachine'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import userFeaturesRegistryItem from '@src/registry/extensions/userFeatures'
import { afterEach, describe, expect, it } from 'vitest'

describe('user features extension', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
  })

  it('provides feature flag context and readiness through the registry', () => {
    registry = new Registry()
    registry.configure([userFeaturesRegistryItem])

    const userFeatures = registry.get(userFeaturesService)

    expect(userFeatures.state.value.matches(UserFeaturesState.Idle)).toBe(true)
    expect(userFeatures.ready.value).toBe(false)
    expect(userFeatures.context.value.featureIds.size).toBe(0)
    expect(userFeatures.has(OPFS_CLOUD_FEATURE_FLAG, false)).toBe(false)
    expect(userFeatures.has(OPFS_CLOUD_FEATURE_FLAG, true)).toBe(true)
  })
})
