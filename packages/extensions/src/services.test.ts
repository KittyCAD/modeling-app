import { computed, signal } from '@preact/signals-core'
import { describe, expect, it, vi } from 'vitest'
import {
  CombineMutationError,
  MissingServiceError,
  ReconfigurationError,
  ServiceConflictError,
  ServiceResolutionError,
} from './errors'
import { appendFacet, firstWinsFacet } from './facet'
import {
  createCompartmentToggleController,
  createPlugin,
  defineExtension,
  defineExtensionFactory,
  pluginsFacet,
  provide,
  provideService,
} from './helpers'
import { ExtensionHost } from './host'
import { defineService } from './service'
import { Compartment } from './types'

describe('services', () => {
  it('resolves singleton services and exposes readonly signal fields', () => {
    const searchService = defineService<{
      query: { readonly value: string }
      setQuery(v: string): void
    }>('search')
    const query = signal('hello')

    const host = new ExtensionHost()
    host.configure([
      defineExtension({
        providesServices: [
          provideService(searchService, {
            query,
            setQuery(v: string) {
              query.value = v
            },
          }),
        ],
      }),
    ])

    const service = host.get(searchService)
    expect(service.query.value).toBe('hello')
    service.setQuery('world')
    expect(service.query.value).toBe('world')
  })

  it('throws for missing required services', () => {
    const service = defineService<{ ok: true }>('missing')
    const host = new ExtensionHost()
    host.configure([])

    expect(() => host.get(service)).toThrow(MissingServiceError)
  })

  it('throws for conflicting singleton services', () => {
    const service = defineService<{ id: string }>('workspace')
    const host = new ExtensionHost()
    host.configure([
      defineExtension({
        providesServices: [provideService(service, { id: 'a' })],
      }),
      defineExtension({
        providesServices: [provideService(service, { id: 'b' })],
      }),
    ])

    expect(() => host.get(service)).toThrow(ServiceConflictError)
  })

  it('throws when a factory eagerly reads a service during graph construction', () => {
    const service = defineService<{ id: string }>('workspace')

    const badFactory = defineExtensionFactory(({ services }) => {
      services.get(service)
      return { extension: defineExtension({}) }
    }, 'bad-factory')

    const host = new ExtensionHost()
    host.configure([
      defineExtension({
        providesServices: [provideService(service, { id: 'a' })],
      }),
      badFactory,
    ])

    expect(() => host.inspect()).toThrow(ServiceResolutionError)
  })

  it('throws when a factory reconfigures a compartment during graph construction', () => {
    const compartment = new Compartment()

    const badFactory = defineExtensionFactory(({ host }) => {
      host.reconfigure(compartment, [])
      return { extension: defineExtension({}) }
    }, 'bad-reconfigure-factory')

    const host = new ExtensionHost()
    host.configure([compartment.of(defineExtension({})), badFactory])

    expect(() => host.inspect()).toThrow(ReconfigurationError)
  })

  it('throws when a same-host service method is called while combining', () => {
    const facet = appendFacet<number>('numbers')
    const service = defineService<{
      count: { readonly value: number }
      mutate(): void
    }>('mutator')
    const count = signal(0)
    const host = new ExtensionHost()

    host.configure([
      defineExtension({
        providesServices: [
          provideService(service, {
            count,
            mutate() {
              count.value += 1
            },
          }),
        ],
        provides: [
          provide(
            facet,
            computed(() => {
              host.get(service).mutate()
              return count.value
            })
          ),
        ],
      }),
    ])

    expect(() => host.get(facet)).toThrow(CombineMutationError)
  })

  it('throws when reconfigure is called during facet combine', () => {
    const facet = appendFacet<number>('numbers')
    const compartment = new Compartment()
    const host = new ExtensionHost()

    host.configure([
      compartment.of(defineExtension({})),
      defineExtension({
        provides: [
          provide(
            facet,
            computed(() => {
              host.reconfigure(compartment, [])
              return 1
            })
          ),
        ],
      }),
    ])

    expect(() => host.get(facet)).toThrow(ReconfigurationError)
  })

  it('toggle controller reconfigures a compartment and preserves unrelated runtime instances', () => {
    const toggleService = defineService<{
      active: { readonly value: boolean }
      enable(): void
      disable(): void
      toggle(): void
    }>('toggle')
    const stableService = defineService<{
      isOpen: { readonly value: boolean }
      open(): void
    }>('stable')
    const featureFacet = appendFacet<string>('feature')
    const compartment = new Compartment()
    const runtimeCalls = vi.fn()

    const stableRuntime = defineExtensionFactory(() => {
      runtimeCalls()
      const isOpen = signal(false)

      return {
        extension: defineExtension({
          providesServices: [
            provideService(stableService, {
              isOpen,
              open() {
                isOpen.value = true
              },
            }),
          ],
        }),
      }
    }, 'stable-runtime')

    const toggleExtension = defineExtensionFactory(({ host }) => {
      const controller = createCompartmentToggleController({
        host,
        compartment,
        activeExtensions: [
          defineExtension({
            provides: [provide(featureFacet, 'enabled')],
          }),
        ],
      })

      return {
        extension: defineExtension({
          providesServices: [provideService(toggleService, controller)],
        }),
      }
    }, 'toggle-extension')

    const host = new ExtensionHost()
    host.configure([stableRuntime, toggleExtension, compartment.of()])

    host.get(stableService).open()
    host.get(toggleService).enable()
    expect(host.get(featureFacet)).toEqual(['enabled'])
    expect(host.get(toggleService).active.value).toBe(true)
    expect(host.get(stableService).isOpen.value).toBe(true)

    host.get(toggleService).disable()
    expect(host.get(featureFacet)).toEqual([])
    expect(host.get(toggleService).active.value).toBe(false)
    expect(host.get(stableService).isOpen.value).toBe(true)
    expect(runtimeCalls).toHaveBeenCalledTimes(1)
  })

  it('installs a plugin as one extension node and preserves its toggle metadata', () => {
    const featureFacet = firstWinsFacet<string>('feature', 'uninitialized')
    const plugin = createPlugin({
      id: 'feature-plugin',
      title: 'Feature Plugin',
      description: 'A toggleable feature plugin.',
      extensions: [
        defineExtension({
          provides: [provide(featureFacet, 'enabled')],
        }),
      ],
    })
    const host = new ExtensionHost()

    host.configure([plugin])

    const [pluginRecord] = host.get(pluginsFacet)

    expect(plugin.id).toBe('feature-plugin')
    expect(host.get(featureFacet)).toEqual('enabled')
    expect(pluginRecord).toEqual(
      expect.objectContaining({
        id: 'feature-plugin',
        title: 'Feature Plugin',
        description: 'A toggleable feature plugin.',
      })
    )

    const pluginService = host.get(pluginRecord.service)
    pluginService.disable()
    expect(host.get(featureFacet)).toEqual('uninitialized')
    pluginService.enable()
    expect(host.get(featureFacet)).toEqual('enabled')
  })

  it('can inspect active service providers', () => {
    const service = defineService<{ id: string }>('workspace')
    const host = new ExtensionHost()
    host.configure([
      defineExtension({
        providesServices: [provideService(service, { id: 'a' })],
      }),
    ])

    expect(host.debugService(service).value).toEqual([
      {
        serviceName: 'workspace',
        sourcePath: 'root[0]',
        multiple: false,
      },
    ])
  })
})
