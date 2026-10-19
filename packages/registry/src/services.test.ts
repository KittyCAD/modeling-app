import { computed, effect, signal } from '@preact/signals-core'
import { describe, expect, it, vi } from 'vitest'
import {
  CombineMutationError,
  MissingServiceError,
  ReconfigurationError,
  RegistryDependencyError,
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
  it('rejects disabling a required plugin without publishing or retaining a broken graph', async () => {
    const api = defineService<{ read(): string }>('required-plugin-api')
    const result = defineService<{ read(): string }>('required-plugin-consumer')
    const disposeProvider = vi.fn()
    const disposeConsumer = vi.fn()
    const createProvider = vi.fn(() => ({
      providesServices: [provideService(api, { read: () => 'available' })],
      dispose: disposeProvider,
    }))
    const plugin = createPlugin({
      id: 'required-plugin',
      title: 'Required plugin',
      description: 'A plugin with an active dependent.',
      items: [defineRegistryItemFactory(createProvider)],
    })
    const createConsumer = vi.fn(
      ({ input }: { input: { readonly value: { read(): string } } }) => ({
        providesServices: [
          provideService(result, { read: () => input.value.read() }),
        ],
        dispose: disposeConsumer,
      })
    )
    const consumer = defineRegistryItemFactory({
      dependencies: { input: { registryItem: plugin, token: api } },
      create: createConsumer,
    })
    const registry = new Registry()
    registry.configure([consumer])
    const record = registry.get(pluginsValueSpec)[0]
    const toggle = registry.get(record.service)
    const originalProvider = registry.get(api)
    const originalConsumer = registry.get(result)
    const observations: string[] = []
    const stop = effect(() => {
      observations.push(`${toggle.active.value}:${registry.get(result).read()}`)
    })
    try {
      // Calling disable must return normally so a caller's .catch can handle it.
      const rejection = vi.fn()
      await toggle.disable().catch(rejection)
      expect(rejection).toHaveBeenCalledWith(
        expect.any(RegistryDependencyError)
      )
      expect(toggle.active.value).toBe(true)
      expect(registry.get(record.service)).toBe(toggle)
      expect(registry.get(api)).toBe(originalProvider)
      expect(registry.get(result)).toBe(originalConsumer)
      expect(originalConsumer.read()).toBe('available')
      expect(observations).toEqual(['true:available'])
      expect(createProvider).toHaveBeenCalledTimes(1)
      expect(createConsumer).toHaveBeenCalledTimes(1)
      expect(disposeProvider).not.toHaveBeenCalled()
      expect(disposeConsumer).not.toHaveBeenCalled()

      // The controller remains useful, including after repeated rejection.
      await expect(toggle.toggle()).rejects.toBeInstanceOf(
        RegistryDependencyError
      )
      stop()
      await registry.configureAsync([plugin])
      await toggle.disable()
      expect(toggle.active.value).toBe(false)
      expect(registry.optional(api)).toBeUndefined()
      await toggle.enable()
      expect(toggle.active.value).toBe(true)
      expect(registry.get(api).read()).toBe('available')
    } finally {
      stop()
      await registry.disposeAsync()
    }
  })

  it('restores a failed enable and disposes only newly staged runtimes', async () => {
    const values = appendValueSpec<string>('staged-values')
    const disposeStaged = vi.fn()
    const failure = new Error('failed setup')
    const nestedSlot = new Slot()
    let attempt = 0
    let fail = true
    const plugin = createPlugin({
      id: 'failed-enable',
      title: 'Failed enable',
      description: 'Fails after mounting a temporary runtime.',
      enabledByDefault: false,
      items: [
        defineRegistryItemFactory(() => {
          attempt++
          return {
            uses: [
              nestedSlot.of({
                provides: [provide(values, `attempt:${attempt}`)],
              }),
            ],
            dispose: disposeStaged,
          }
        }),
        defineRegistryItemFactory(() => {
          if (fail) throw failure
          return {}
        }),
      ],
    })
    const registry = new Registry()
    registry.configure([plugin])
    const record = registry.get(pluginsValueSpec)[0]
    const toggle = registry.get(record.service)
    await expect(toggle.enable()).rejects.toBe(failure)
    expect(toggle.active.value).toBe(false)
    expect(registry.get(values)).toEqual([])
    expect(registry.get(record.service)).toBe(toggle)
    expect(disposeStaged).toHaveBeenCalledTimes(1)
    fail = false
    await toggle.enable()
    expect(toggle.active.value).toBe(true)
    expect(registry.get(values)).toEqual(['attempt:2'])
    await registry.disposeAsync()
    expect(disposeStaged).toHaveBeenCalledTimes(2)
  })

  it('keeps a disable committed while cleanup is pending or fails', async () => {
    const api = defineService<{ ok: boolean }>('cleanup-plugin-api')
    const failure = new Error('cleanup failed')
    let rejectCleanup!: (error: Error) => void
    const cleanup = new Promise<void>((_, reject) => {
      rejectCleanup = reject
    })
    const dispose = vi.fn(() => cleanup)
    const plugin = createPlugin({
      id: 'cleanup-plugin',
      title: 'Cleanup plugin',
      description: 'Commits before cleanup completes.',
      items: [
        defineRegistryItemFactory(() => ({
          providesServices: [provideService(api, { ok: true })],
          dispose,
        })),
      ],
    })
    const registry = new Registry()
    registry.configure([plugin])
    const toggle = registry.get(registry.get(pluginsValueSpec)[0].service)
    const completion = toggle.disable()
    expect(toggle.active.value).toBe(false)
    expect(registry.optional(api)).toBeUndefined()
    rejectCleanup(failure)
    await expect(completion).rejects.toEqual(
      new AggregateError(
        [failure],
        'One or more registry runtime instances failed to dispose.'
      )
    )
    expect(toggle.active.value).toBe(false)
    expect(registry.optional(api)).toBeUndefined()
    await toggle.enable()
    expect(registry.get(api).ok).toBe(true)
    // The next instance has the same failing finalizer; it still unmounts once.
    await expect(registry.disposeAsync()).rejects.toBeInstanceOf(AggregateError)
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it('resolves services and exposes readonly Preact signal fields', () => {
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

  it('rejects multiple providers for one service', () => {
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
      return {}
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

  it('rejects when a factory reconfigures a slot during graph construction', async () => {
    const slot = new Slot()
    let completion: Promise<void> | undefined

    const badFactory = defineRegistryItemFactory(({ container }) => {
      completion = container.reconfigure(slot, [])
      return {}
    }, 'bad-reconfigure-factory')

    const container = new Registry()
    container.configure([slot.of(defineRegistryItem({})), badFactory])

    container.inspect()
    await expect(completion).rejects.toBeInstanceOf(ReconfigurationError)
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

  it('rejects when reconfigure is called during value-spec combine', async () => {
    const registrySignal = appendValueSpec<number>('numbers')
    const slot = new Slot()
    const container = new Registry()
    let completion: Promise<void> | undefined

    container.configure([
      slot.of(defineRegistryItem({})),
      defineRegistryItem({
        provides: [
          provide(
            registrySignal,
            computed(() => {
              completion = container.reconfigure(slot, [])
              return 1
            })
          ),
        ],
      }),
    ])

    expect(container.get(registrySignal)).toEqual([1])
    await expect(completion).rejects.toBeInstanceOf(ReconfigurationError)
  })

  it('toggle controller reconfigures a slot and preserves unrelated runtime instances', async () => {
    const toggleService = defineService<{
      active: { readonly value: boolean }
      enable(): Promise<void>
      disable(): Promise<void>
      toggle(): Promise<void>
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
        providesServices: [
          provideService(stableService, {
            isOpen,
            open() {
              isOpen.value = true
            },
          }),
        ],
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
        providesServices: [provideService(toggleService, controller)],
      }
    }, 'toggle-registry-item')

    const container = new Registry()
    container.configure([stableRuntime, toggleRegistryItem, slot.of()])

    const stable = container.get(stableService)
    stable.open()
    await container.get(toggleService).enable()
    expect(container.get(featureSignal)).toEqual(['enabled'])
    expect(container.get(toggleService).active.value).toBe(true)
    expect(container.get(stableService).isOpen.value).toBe(true)
    expect(container.get(stableService)).toBe(stable)

    await container.get(toggleService).disable()
    expect(container.get(featureSignal)).toEqual([])
    expect(container.get(toggleService).active.value).toBe(false)
    expect(container.get(stableService).isOpen.value).toBe(true)
    expect(container.get(stableService)).toBe(stable)
    expect(runtimeCalls).toHaveBeenCalledTimes(1)
  })

  it('updates the service when its provider is replaced', () => {
    const service = defineService<{ name(): string }>('workspace')
    const slot = new Slot()
    const container = new Registry()
    container.configure([
      slot.of({
        providesServices: [provideService(service, { name: () => 'a' })],
      }),
    ])
    const original = container.get(service)

    void container.reconfigure(slot, [
      { providesServices: [provideService(service, { name: () => 'b' })] },
    ])

    expect(container.get(service)).not.toBe(original)
    expect(container.get(service).name()).toBe('b')
  })

  it('installs a plugin as one registry node and preserves its toggle metadata', async () => {
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
    await pluginService.disable()
    expect(container.get(featureSignal)).toEqual('uninitialized')
    await pluginService.enable()
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
      },
    ])
  })
})
