import { updateEnvironment } from '@src/env'
import { runtimeService } from '@src/registry/contracts/runtime'
import runtimeRegistryItem from '@src/registry/extensions/runtime'
import { Registry } from 'plankton'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('runtime extension', () => {
  let registry: Registry | undefined
  afterEach(async () => {
    await registry?.dispose()
    registry = undefined
    updateEnvironment(null)
    vi.unstubAllGlobals()
  })
  it('provides runtime target and environment metadata', async () => {
    registry = new Registry()
    await registry.configure([runtimeRegistryItem])
    const runtime = registry.required(runtimeService)
    const current = runtime.get()

    expect(current.hasWindow).toBe(true)
    expect(current.target).toBe(current.isDesktop ? 'desktop' : 'web')
    expect(current.isServer).toBe(false)
    expect(current.environmentName).toBeTruthy()
    expect(runtime.current.value).toEqual(current)
    expect(runtime.refresh()).toEqual(runtime.current.value)
  })
  it('refreshes runtime metadata when the desktop environment changes', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Electron' })
    vi.stubGlobal('electron', {
      process: {
        env: {
          NODE_ENV: 'test',
          VITE_ZOO_BASE_DOMAIN: 'zoo.dev',
        },
      },
    })
    registry = new Registry()
    await registry.configure([runtimeRegistryItem])
    const runtime = registry.required(runtimeService)
    updateEnvironment('customer.example')

    expect(runtime.current.value).toMatchObject({
      target: 'desktop',
      environmentName: 'customer.example',
      baseDomain: 'customer.example',
      apiBaseUrl: 'https://api.customer.example',
    })
  })
})
