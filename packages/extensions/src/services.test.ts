import { computed, signal } from '@preact/signals-core'
import { describe, expect, it, vi } from 'vitest'
import {
  CombineMutationError,
  MissingServiceError,
  ReconfigurationError,
  ServiceConflictError,
  ServiceResolutionError,
} from './errors'
import { appendSignal, firstWinsSignal } from './signal'
import {
  createSlotToggleController,
  createPlugin,
  defineExtension,
  defineExtensionFactory,
  pluginsSignal,
  provide,
  provideService,
} from './helpers'
import { ExtensionContainer } from './container'
import { defineService } from './service'
import { Slot } from './types'

describe('services', () => {
  it('resolves singleton services and exposes readonly signal fields', () => {
    const searchService = defineService<{
      query: { readonly value: string }
      setQuery(v: string): void
    }>('search')
    const query = signal('hello')

    const container = new ExtensionContainer()
    container.configure([
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

    const service = container.get(searchService)
    expect(service.query.value).toBe('hello')
    service.setQuery('world')
    expect(service.query.value).toBe('world')
  })

  it('throws for missing required services', () => {
    const service = defineService<{ ok: true }>('missing')
    const container = new ExtensionContainer()
    container.configure([])

    expect(() => container.get(service)).toThrow(MissingServiceError)
  })

  it('throws for conflicting singleton services', () => {
    const service = defineService<{ id: string }>('workspace')
    const container = new ExtensionContainer()
    container.configure([
      defineExtension({
        providesServices: [provideService(service, { id: 'a' })],
      }),
      defineExtension({
        providesServices: [provideService(service, { id: 'b' })],
      }),
    ])

    expect(() => container.get(service)).toThrow(ServiceConflictError)
  })

  it('throws when a factory eagerly reads a service during graph construction', () => {
    const service = defineService<{ id: string }>('workspace')

    const badFactory = defineExtensionFactory(({ services }) => {
      services.get(service)
      return { extension: defineExtension({}) }
    }, 'bad-factory')

    const container = new ExtensionContainer()
    container.configure([
      defineExtension({
        providesServices: [provideService(service, { id: 'a' })],
      }),
      badFactory,
    ])

    expect(() => container.inspect()).toThrow(ServiceResolutionError)
  })

  it('throws when a factory reconfigures a slot during graph construction', () => {
    const slot = new Slot()

    const badFactory = defineExtensionFactory(({ container }) => {
      container.reconfigure(slot, [])
      return { extension: defineExtension({}) }
    }, 'bad-reconfigure-factory')

    const container = new ExtensionContainer()
    container.configure([slot.of(defineExtension({})), badFactory])

    expect(() => container.inspect()).toThrow(ReconfigurationError)
  })

  it('throws when a same-container service method is called while combining', () => {
    const extensionSignal = appendSignal<number>('numbers')
    const service = defineService<{
      count: { readonly value: number }
      mutate(): void
    }>('mutator')
    const count = signal(0)
    const container = new ExtensionContainer()

    container.configure([
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
            extensionSignal,
            computed(() => {
              container.get(service).mutate()
              return count.value
            })
          ),
        ],
      }),
    ])

    expect(() => container.get(extensionSignal)).toThrow(CombineMutationError)
  })

  it('throws when reconfigure is called during signal combine', () => {
    const extensionSignal = appendSignal<number>('numbers')
    const slot = new Slot()
    const container = new ExtensionContainer()

    container.configure([
      slot.of(defineExtension({})),
      defineExtension({
        provides: [
          provide(
            extensionSignal,
            computed(() => {
              container.reconfigure(slot, [])
              return 1
            })
          ),
        ],
      }),
    ])

    expect(() => container.get(extensionSignal)).toThrow(ReconfigurationError)
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
    const featureSignal = appendSignal<string>('feature')
    const slot = new Slot()
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

    const toggleExtension = defineExtensionFactory(({ container }) => {
      const controller = createSlotToggleController({
        container,
        slot,
        activeExtensions: [
          defineExtension({
            provides: [provide(featureSignal, 'enabled')],
          }),
        ],
      })

      return {
        extension: defineExtension({
          providesServices: [provideService(toggleService, controller)],
        }),
      }
    }, 'toggle-extension')

    const container = new ExtensionContainer()
    container.configure([stableRuntime, toggleExtension, slot.of()])

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

  it('installs a plugin as one extension node and preserves its toggle metadata', () => {
    const featureSignal = firstWinsSignal<string>('feature', 'uninitialized')
    const plugin = createPlugin({
      id: 'feature-plugin',
      title: 'Feature Plugin',
      description: 'A toggleable feature plugin.',
      extensions: [
        defineExtension({
          provides: [provide(featureSignal, 'enabled')],
        }),
      ],
    })
    const container = new ExtensionContainer()

    container.configure([plugin])

    const [pluginRecord] = container.get(pluginsSignal)

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
    const container = new ExtensionContainer()
    container.configure([
      defineExtension({
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
