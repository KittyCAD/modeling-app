import { describe, expect, it } from 'vitest'
import { isModeSketchDebugExtensionsAvailable } from './debugAvailability'

describe('mode sketch debug extension availability', () => {
  it('allows local development', () => {
    expect(
      isModeSketchDebugExtensionsAvailable({ nodeEnv: 'development' })
    ).toBe(true)
  })

  it('allows staging builds and preview deployments', () => {
    expect(
      isModeSketchDebugExtensionsAvailable({
        packageName: 'zoo-modeling-app-staging',
      })
    ).toBe(true)
    expect(isModeSketchDebugExtensionsAvailable({ vercelEnv: 'preview' })).toBe(
      true
    )
    expect(
      isModeSketchDebugExtensionsAvailable({ baseDomain: 'dev.zoo.dev' })
    ).toBe(true)
  })

  it('allows tests to register debug extensions for coverage', () => {
    expect(isModeSketchDebugExtensionsAvailable({ nodeEnv: 'test' })).toBe(true)
  })

  it('blocks production builds', () => {
    expect(
      isModeSketchDebugExtensionsAvailable({
        nodeEnv: 'production',
        vercelEnv: 'production',
        baseDomain: 'zoo.dev',
        packageName: 'zoo-modeling-app',
        packageVersion: '1.2.3',
      })
    ).toBe(false)
  })
})
