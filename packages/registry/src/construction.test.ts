import { signal } from '@preact/signals-core'
import fc from 'fast-check'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { defineRegistryItemFactory, provide, provideService } from './helpers'
import {
  RegistryDependencyError,
  ServiceConflictError,
  ServiceResolutionError,
} from './errors'
import { Registry } from './registry'
import { defineService } from './service'
import { Slot, type RegistryItem, type RegistryItemDefinition } from './types'
import { appendValueSpec } from './valueSpec'

describe('constructor dependency reads', () => {
  it('infers named service snapshots without evaluating live inputs', () => {
    const source = defineService<{ name: string }>('source')
    const output = defineService<{ name: string }>('output')
    const provider = defineRegistryItemFactory(() => ({
      providesServices: [provideService(source, { name: 'ready' })],
    }))
    const consumer = defineRegistryItemFactory({
      id: 'consumer',
      dependencies: { source: { registryItem: provider, token: source } },
      create(_live, read) {
        const captured = read('source')
        expectTypeOf(captured).toEqualTypeOf<{ name: string }>()
        return { providesServices: [provideService(output, captured)] }
      },
    })
    const registry = new Registry()
    registry.configure([consumer])
    expect(registry.get(output).name).toBe('ready')
  })

  it('keeps value composition live and rejects constructor reads in types and JavaScript', () => {
    const commands = appendValueSpec<string>('commands')
    const output = defineService<{ live(): readonly string[] }>('output')
    const source = signal('Open')
    const core = { provides: [provide(commands, source)] }
    const plugin = { provides: [provide(commands, 'Export')] }
    const create = vi.fn()
    const consumer = defineRegistryItemFactory({
      dependencies: { commands: { registryItem: core, token: commands } },
      create(live, read) {
        create()
        expect(() => {
          // @ts-expect-error Value specs are composed after constructor capabilities are wired.
          read('commands')
        }).toThrow(RegistryDependencyError)
        return {
          providesServices: [
            provideService(output, {
              live: () => live.commands.value,
            }),
          ],
        }
      },
    })
    const registry = new Registry()
    registry.configure([consumer, plugin])
    const result = registry.get(output)
    expect(result.live()).toEqual(['Open', 'Export'])
    source.value = 'Open recent'
    expect(registry.get(output)).toBe(result)
    expect(result.live()).toEqual(['Open recent', 'Export'])
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('selects a test runtime explicitly without constructing the production provider', async () => {
    const runtime = defineService<{ ready: Promise<string> }>('runtime')
    const output = defineService<{ ready: Promise<string> }>('output')
    const production = vi.fn(() => ({
      providesServices: [
        provideService(runtime, { ready: Promise.resolve('production') }),
      ],
    }))
    const productionProvider = defineRegistryItemFactory(
      production,
      'production-runtime'
    )
    let finishInitialization: (value: string) => void = () => {
      throw new Error('Missing resolver')
    }
    const ready = new Promise<string>((resolve) => {
      finishInitialization = resolve
    })
    const mockProvider = defineRegistryItemFactory(
      () => ({
        providesServices: [provideService(runtime, { ready })],
      }),
      'mock-runtime'
    )
    const createConsumer = (provider: RegistryItem) =>
      defineRegistryItemFactory({
        dependencies: { runtime: { registryItem: provider, token: runtime } },
        create(_live, read) {
          return {
            providesServices: [
              provideService(output, { ready: read('runtime').ready }),
            ],
          }
        },
      })
    // The composition root chooses the test provider instead of installing both.
    const selectedProvider = {
      production: productionProvider,
      test: mockProvider,
    }.test
    const registry = new Registry()
    registry.configure([createConsumer(selectedProvider)])
    expect(registry.get(output).ready).toBe(ready)
    expect(production).not.toHaveBeenCalled()
    finishInitialization('test-runtime')
    await expect(registry.get(output).ready).resolves.toBe('test-runtime')
    await registry.disposeAsync()
  })

  it('rejects value-spec construction reads through the callback context too', () => {
    const commands = appendValueSpec<string>('commands')
    const consumer = defineRegistryItemFactory(({ valueSpecs }) => {
      valueSpecs.get(commands)
      return {}
    })
    const registry = new Registry()
    registry.configure([consumer])
    expect(() => registry.inspect()).toThrow(ServiceResolutionError)
  })

  it('rejects an unrelated second service provider in every root order', () => {
    const source = defineService<{ name: string }>('source')
    const output = defineService<{ name: string }>('output')
    const production = {
      providesServices: [provideService(source, { name: 'production' })],
    }
    const mock = {
      providesServices: [provideService(source, { name: 'test' })],
    }
    const consumer = defineRegistryItemFactory({
      dependencies: { source: { registryItem: production, token: source } },
      create(_live, read) {
        return { providesServices: [provideService(output, read('source'))] }
      },
    })
    fc.assert(
      fc.property(
        fc.shuffledSubarray([production, mock, consumer], {
          minLength: 3,
          maxLength: 3,
        }),
        (roots) => {
          const registry = new Registry()
          registry.configure(roots)
          expect(() => registry.get(output)).toThrow(ServiceConflictError)
          registry[Symbol.dispose]()
        }
      )
    )
  })

  it('rolls back a conflicting provider without replacing the captured runtime', async () => {
    const source = defineService<{ name: string }>('source')
    const output = defineService<{ name: string }>('output')
    const extra = new Slot()
    const disposeMock = vi.fn()
    const production = {
      providesServices: [provideService(source, { name: 'production' })],
    }
    const mock = defineRegistryItemFactory(() => ({
      providesServices: [provideService(source, { name: 'test' })],
      dispose: disposeMock,
    }))
    const consumer = defineRegistryItemFactory({
      dependencies: { source: { registryItem: production, token: source } },
      create(_live, read) {
        return { providesServices: [provideService(output, read('source'))] }
      },
    })
    const registry = new Registry()
    registry.configure([consumer, extra.of()])
    const original = registry.get(output)
    await expect(registry.reconfigure(extra, [mock])).rejects.toThrow(
      ServiceConflictError
    )
    expect(registry.get(output)).toBe(original)
    expect(registry.get(source).name).toBe('production')
    expect(disposeMock).toHaveBeenCalledOnce()
    await registry.disposeAsync()
  })

  it('includes complete shared declarative cycles in the dependency scope', () => {
    const source = defineService<{ name: string }>('source')
    const output = defineService<{ name: string }>('output')
    const children: RegistryItem[] = []
    const first: RegistryItemDefinition = { uses: children }
    const second = { uses: [first] }
    children.push(second, {
      providesServices: [provideService(source, { name: 'reachable' })],
    })
    const consumer = defineRegistryItemFactory({
      dependencies: { source: { registryItem: second, token: source } },
      create(_live, read) {
        return { providesServices: [provideService(output, read('source'))] }
      },
    })
    const registry = new Registry()
    registry.configure([first, consumer])
    expect(registry.get(output).name).toBe('reachable')
  })

  it('rebuilds capturing dependents and disposes old consumers before providers', async () => {
    const source = defineService<{ name: string }>('source')
    const middle = defineService<{ name: string }>('middle')
    const output = defineService<{ name: string }>('output')
    const slot = new Slot()
    const unrelated = new Slot()
    const events: string[] = []
    const provider = (name: string) =>
      defineRegistryItemFactory(
        () => ({
          providesServices: [provideService(source, { name })],
          dispose: () => {
            events.push(`source:${name}`)
          },
        }),
        `source:${name}`
      )
    const consumer = defineRegistryItemFactory({
      id: 'consumer',
      dependencies: {
        source: { registryItem: slot.of(provider('one')), token: source },
      },
      create(_live, read) {
        const captured = read('source')
        return {
          providesServices: [provideService(middle, captured)],
          dispose: () => {
            events.push(`middle:${captured.name}`)
          },
        }
      },
    })
    const dependent = defineRegistryItemFactory({
      id: 'dependent',
      dependencies: { middle: { registryItem: consumer, token: middle } },
      create(_live, read) {
        const captured = read('middle')
        return {
          providesServices: [provideService(output, captured)],
          dispose: () => {
            events.push(`output:${captured.name}`)
          },
        }
      },
    })
    const registry = new Registry()
    registry.configure([dependent, unrelated.of()])
    const first = registry.get(output)
    await registry.reconfigure(unrelated, [{}])
    expect(registry.get(output)).toBe(first)
    await registry.reconfigure(slot, [provider('two')])
    expect(registry.get(output).name).toBe('two')
    expect(registry.get(output)).not.toBe(first)
    expect(events).toEqual(['output:one', 'middle:one', 'source:one'])
    await registry.disposeAsync()
    expect(events.slice(3)).toEqual(['output:two', 'middle:two', 'source:two'])
  })

  it('rolls back failed replacements and cleans new instances in construction order', async () => {
    const source = defineService<{ name: string }>('source')
    const output = defineService<{ name: string }>('output')
    const slot = new Slot()
    const events: string[] = []
    const provider = (name: string) =>
      defineRegistryItemFactory(
        () => ({
          providesServices: [provideService(source, { name })],
          dispose: () => {
            events.push(`source:${name}`)
          },
        }),
        `source:${name}`
      )
    const consumer = defineRegistryItemFactory({
      id: 'consumer',
      dependencies: {
        source: { registryItem: slot.of(provider('one')), token: source },
      },
      create(_live, read) {
        const captured = read('source')
        return {
          providesServices: [provideService(output, captured)],
          dispose: () => {
            events.push(`output:${captured.name}`)
          },
        }
      },
    })
    const dependent = defineRegistryItemFactory({
      id: 'dependent',
      dependencies: { output: { registryItem: consumer, token: output } },
      create(_live, read) {
        if (read('output').name === 'broken') throw new Error('setup failed')
        return {}
      },
    })
    const registry = new Registry()
    registry.configure([dependent])
    const original = registry.get(output)
    await expect(
      registry.reconfigure(slot, [provider('broken')])
    ).rejects.toThrow('setup failed')
    expect(events).toEqual(['output:broken', 'source:broken'])
    expect(registry.get(output)).toBe(original)
    await registry.disposeAsync()
    expect(events.slice(2)).toEqual(['output:one', 'source:one'])
  })
})
