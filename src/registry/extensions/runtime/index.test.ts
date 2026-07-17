import { Registry } from '@kittycad/registry'
import { runtimeService } from '@src/registry/contracts/runtime'
import runtimeRegistryItem from '@src/registry/extensions/runtime'
import { afterEach, describe, expect, it } from 'vitest'

describe('runtime extension', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
  })

  it('provides runtime target and environment metadata', () => {
    registry = new Registry()
    registry.configure([runtimeRegistryItem])

    const runtime = registry.get(runtimeService)
    const current = runtime.get()

    expect(current.hasWindow).toBe(true)
    expect(current.target).toBe(current.isDesktop ? 'desktop' : 'web')
    expect(current.isServer).toBe(false)
    expect(current.environmentName).toBeTruthy()
    expect(runtime.current.value).toEqual(current)
    expect(runtime.refresh()).toEqual(runtime.current.value)
  })
})
