import { computed, signal } from '@preact/signals-core'
import { describe, expect, it } from 'vitest'
import {
  CombineMutationError,
  MissingServiceError,
  ServiceConflictError,
  ServiceResolutionError,
} from './errors'
import { appendFacet } from './facet'
import {
  defineExtension,
  defineExtensionFactory,
  provide,
  provideService,
} from './helpers'
import { ExtensionHost } from './host'
import { defineService } from './service'

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
