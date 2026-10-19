import { signal } from '@preact/signals-core'
import fc from 'fast-check'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { defineRegistryItemFactory, provide, provideService } from './helpers'
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

  it('separates scoped constructor values from complete live composition', () => {
    const commands = appendValueSpec<string>('commands')
    const output = defineService<{
      captured: readonly string[]
      live(): readonly string[]
    }>('output')
    const source = signal('Open')
    const core = { provides: [provide(commands, source)] }
    const plugin = { provides: [provide(commands, 'Export')] }
    const create = vi.fn()
    const consumer = defineRegistryItemFactory({
      dependencies: { commands: { registryItem: core, token: commands } },
      create(live, read) {
        create()
        const captured = read('commands')
        expectTypeOf(captured).toEqualTypeOf<readonly string[]>()
        return {
          providesServices: [
            provideService(output, {
              captured,
              live: () => live.commands.value,
            }),
          ],
        }
      },
    })
    const registry = new Registry()
    registry.configure([consumer, plugin])
    const result = registry.get(output)
    expect(result.captured).toEqual(['Open'])
    expect(result.live()).toEqual(['Open', 'Export'])
    source.value = 'Open recent'
    expect(registry.get(output)).toBe(result)
    expect(result.captured).toEqual(['Open'])
    expect(result.live()).toEqual(['Open recent', 'Export'])
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('composes constructor values independently of root ordering', () => {
    const values = appendValueSpec<string>('values')
    const output = defineService<{ captured: readonly string[] }>('output')
    const first = { provides: [provide(values, 'first', { key: 'duplicate' })] }
    const second = {
      provides: [
        provide(values, 'discarded', { key: 'duplicate' }),
        provide(values, 'priority', { precedence: 'highest' }),
      ],
    }
    const unrelated = { provides: [provide(values, 'unrelated')] }
    const consumer = defineRegistryItemFactory({
      dependencies: {
        first: { registryItem: first, token: values },
        second: { registryItem: second, token: values },
      },
      create(_live, read) {
        return {
          providesServices: [
            provideService(output, { captured: read('first') }),
          ],
        }
      },
    })
    fc.assert(
      fc.property(
        fc.shuffledSubarray([first, second, unrelated, consumer], {
          minLength: 4,
          maxLength: 4,
        }),
        (roots) => {
          const registry = new Registry()
          registry.configure(roots)
          try {
            expect(registry.get(output).captured).toEqual(['priority', 'first'])
          } finally {
            registry[Symbol.dispose]()
          }
        }
      )
    )
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
