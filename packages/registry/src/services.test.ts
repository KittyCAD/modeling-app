import { computed, signal } from '@preact/signals-core'
import { describe, expect, it, vi } from 'vitest'
import {
  CombineMutationError,
  MissingServiceError,
  ReconfigurationError,
  ServiceConflictError,
  ServiceResolutionError,
} from './errors'
import {
  createPlugin,
  createSlotToggleController,
  defineRegistryItem,
  defineRegistryItemFactory,
  pluginsValueSpec,
  provide,
  provideService,
} from './helpers'
import { Registry } from './registry'
import { defineService } from './service'
import { Slot } from './types'
import { appendValueSpec, firstWinsValueSpec } from './valueSpec'

describe('services', () => {
  it('resolves singleton services and exposes readonly Preact signal fields', () => {
    const searchService = defineService<{
      query: { readonly value: string }
      setQuery(v: string): void
    }>('search')
    const query = signal('hello')

    const container = new Registry()
    container.configure([
      defineRegistryItem({
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

    const service = container.get(searchService)
    expect(service.query.value).toBe('hello')
    service.setQuery('world')
    expect(service.query.value).toBe('world')
  })

  it('throws for missing required services', () => {
    const service = defineService<{ ok: true }>('missing')
    const container = new Registry()
    container.configure([])

    expect(() => container.get(service)).toThrow(MissingServiceError)
  })

  it('throws for conflicting singleton services', () => {
    const service = defineService<{ id: string }>('workspace')
    const container = new Registry()
    container.configure([
      defineRegistryItem({
        providesServices: [provideService(service, { id: 'a' })],
      }),
      defineRegistryItem({
        providesServices: [provideService(service, { id: 'b' })],
      }),
    ])

    expect(() => container.get(service)).toThrow(ServiceConflictError)
  })

  it('throws when a factory eagerly reads a service during graph construction', () => {
    const service = defineService<{ id: string }>('workspace')

    const badFactory = defineRegistryItemFactory(({ services }) => {
      services.get(service)
      return { item: defineRegistryItem({}) }
    }, 'bad-factory')

    const container = new Registry()
    container.configure([
      defineRegistryItem({
        providesServices: [provideService(service, { id: 'a' })],
      }),
      badFactory,
    ])

    expect(() => container.inspect()).toThrow(ServiceResolutionError)
  })

  it('throws when a factory reconfigures a slot during graph construction', () => {
    const slot = new Slot()

    const badFactory = defineRegistryItemFactory(({ container }) => {
      container.reconfigure(slot, [])
      return { item: defineRegistryItem({}) }
    }, 'bad-reconfigure-factory')

    const container = new Registry()
    container.configure([slot.of(defineRegistryItem({})), badFactory])

    expect(() => container.inspect()).toThrow(ReconfigurationError)
  })

  it('throws when a same-container service method is called while combining', () => {
    const registrySignal = appendValueSpec<number>('numbers')
    const service = defineService<{
      count: { readonly value: number }
      mutate(): void
    }>('mutator')
    const count = signal(0)
    const container = new Registry()

    container.configure([
      defineRegistryItem({
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
            registrySignal,
            computed(() => {
              container.get(service).mutate()
              return count.value
            })
          ),
        ],
      }),
    ])

    expect(() => container.get(registrySignal)).toThrow(CombineMutationError)
  })

  it('throws when reconfigure is called during value-spec combine', () => {
    const registrySignal = appendValueSpec<number>('numbers')
    const slot = new Slot()
    const container = new Registry()

    container.configure([
      slot.of(defineRegistryItem({})),
      defineRegistryItem({
        provides: [
          provide(
            registrySignal,
            computed(() => {
              container.reconfigure(slot, [])
              return 1
            })
          ),
        ],
      }),
    ])

    expect(() => container.get(registrySignal)).toThrow(ReconfigurationError)
  })

  it('toggle controller reconfigures a slot and preserves unrelated runtime instances', () => {
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
    const featureSignal = appendValueSpec<string>('feature')
    const slot = new Slot()
    const runtimeCalls = vi.fn()

    const stableRuntime = defineRegistryItemFactory(() => {
      runtimeCalls()
      const isOpen = signal(false)

      return {
        item: defineRegistryItem({
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

    const toggleRegistryItem = defineRegistryItemFactory(({ container }) => {
      const controller = createSlotToggleController({
        container,
        slot,
        activeItems: [
          defineRegistryItem({
            provides: [provide(featureSignal, 'enabled')],
          }),
        ],
      })

      return {
        item: defineRegistryItem({
          providesServices: [provideService(toggleService, controller)],
        }),
      }
    }, 'toggle-registry-item')

    const container = new Registry()
    container.configure([stableRuntime, toggleRegistryItem, slot.of()])

    container.get(stableService).open()
    container.get(toggleService).enable()
    expect(container.get(featureSignal)).toEqual(['enabled'])
    expect(container.get(toggleService).active.value).toBe(true)
    expect(container.get(stableService).isOpen.value).toBe(true)

    container.get(toggleService).disable()
    expect(container.get(featureSignal)).toEqual([])
    expect(container.get(toggleService).active.value).toBe(false)
    expect(container.get(stableService).isOpen.value).toBe(true)
    expect(runtimeCalls).toHaveBeenCalledTimes(1)
  })

  it('installs a plugin as one registry node and preserves its toggle metadata', () => {
    const featureSignal = firstWinsValueSpec<string>('feature', 'uninitialized')
    const plugin = createPlugin({
      id: 'feature-plugin',
      title: 'Feature Plugin',
      description: 'A toggleable feature plugin.',
      items: [
        defineRegistryItem({
          provides: [provide(featureSignal, 'enabled')],
        }),
      ],
    })
    const container = new Registry()

    container.configure([plugin])

    const [pluginRecord] = container.get(pluginsValueSpec)

    expect(plugin.id).toBe('feature-plugin')
    expect(container.get(featureSignal)).toEqual('enabled')
    expect(pluginRecord).toEqual(
      expect.objectContaining({
        id: 'feature-plugin',
        title: 'Feature Plugin',
        description: 'A toggleable feature plugin.',
      })
    )

    const pluginService = container.get(pluginRecord.service)
    pluginService.disable()
    expect(container.get(featureSignal)).toEqual('uninitialized')
    pluginService.enable()
    expect(container.get(featureSignal)).toEqual('enabled')
  })

  it('can inspect active service providers', () => {
    const service = defineService<{ id: string }>('workspace')
    const container = new Registry()
    container.configure([
      defineRegistryItem({
        providesServices: [provideService(service, { id: 'a' })],
      }),
    ])

    expect(container.debugService(service).value).toEqual([
      {
        serviceName: 'workspace',
        sourcePath: 'root[0]',
        multiple: false,
      },
    ])
  })
})
