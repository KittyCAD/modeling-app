import { extension } from './algebra'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import {
  contribute,
  createPlugin,
  Facet,
  plugins,
  Registry,
  type Extension,
} from './next'

const info = {
  id: 'tools',
  title: 'Tools',
  description: 'Optional editing tools',
}

it('keeps controller and metadata installed through generated toggle histories', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.boolean(),
      fc.array(fc.constantFrom('enable', 'disable', 'toggle'), {
        maxLength: 12,
      }),
      async (enabledByDefault, operations) => {
        const registry = new Registry()
        const commands = new Facet(
          'commands',
          (values: readonly string[]) => values
        )
        let acquired = 0
        let released = 0
        const resource: Extension = extension({
          create: () => {
            acquired++
            return {
              items: [contribute(commands, () => 'format')],
              dispose: async () => {
                await Promise.resolve()
                released++
              },
            }
          },
        })
        await registry.configure([
          createPlugin({ ...info, items: [resource], enabledByDefault }),
        ])
        const [record] = registry.get(plugins)
        const controller = registry.required(record.service)
        const active = controller.active
        let expected = enabledByDefault
        let expectedAcquisitions = expected ? 1 : 0
        let expectedReleases = 0
        expect(active.value).toBe(expected)
        expect(registry.get(commands)).toEqual(expected ? ['format'] : [])

        for (const operation of operations) {
          const next =
            operation === 'toggle' ? !expected : operation === 'enable'
          if (!expected && next) expectedAcquisitions++
          if (expected && !next) expectedReleases++
          await controller[operation]()
          expected = next
          const records = registry.get(plugins)
          expect(records).toHaveLength(1)
          expect(records[0]).toMatchObject(info)
          expect(records[0].service).toBe(record.service)
          expect(registry.required(record.service)).toBe(controller)
          expect(controller.active).toBe(active)
          expect(active.value).toBe(expected)
          expect(registry.get(commands)).toEqual(expected ? ['format'] : [])
          expect(acquired).toBe(expectedAcquisitions)
          expect(released).toBe(expectedReleases)
        }
        await registry.dispose()
        expect(registry.get(plugins)).toEqual([])
        expect(registry.optional(record.service)).toBeUndefined()
        expect(active.value).toBe(false)
        expect(released).toBe(expectedReleases + (expected ? 1 : 0))
      }
    ),
    { numRuns: 150 }
  )
})

it('publishes disabled content before awaiting its resource cleanup', async () => {
  const registry = new Registry()
  let finish: () => void = () => {
    throw new Error('Cleanup has not begun')
  }
  const resource: Extension = extension({
    create: () => ({
      items: [],
      dispose: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    }),
  })
  await registry.configure([createPlugin({ ...info, items: [resource] })])
  const [record] = registry.get(plugins)
  const controller = registry.required(record.service)
  const disabling = controller.disable()
  let complete = false
  void disabling.then(
    () => {
      complete = true
    },
    () => {}
  )
  await Promise.resolve()
  expect(controller.active.value).toBe(false)
  expect(complete).toBe(false)
  expect(registry.get(plugins)).toHaveLength(1)
  finish()
  await disabling
  expect(complete).toBe(true)
  expect(registry.required(record.service)).toBe(controller)
  await registry.dispose()
})

it('retains the committed disabled state when cleanup rejects', async () => {
  const registry = new Registry()
  const failure = new Error('Cleanup failed')
  let releases = 0
  const resource: Extension = extension({
    create: () => ({
      items: [],
      dispose: () => {
        releases++
        throw failure
      },
    }),
  })
  await registry.configure([createPlugin({ ...info, items: [resource] })])
  const [record] = registry.get(plugins)
  const controller = registry.required(record.service)
  expect(controller.active.value).toBe(true)
  await expect(controller.disable()).rejects.toMatchObject({
    errors: [failure],
  })
  expect(controller.active.value).toBe(false)
  expect(registry.required(record.service)).toBe(controller)
  expect(registry.get(plugins)).toHaveLength(1)
  await registry.dispose()
  expect(registry.get(plugins)).toEqual([])
  expect(releases).toBe(1)
})

it('keeps a disabled plugin disabled when enabling its resources fails', async () => {
  const registry = new Registry()
  const failure = new Error('Acquisition failed')
  const resource: Extension = extension({
    create: () => {
      throw failure
    },
  })
  await registry.configure([
    createPlugin({ ...info, items: [resource], enabledByDefault: false }),
  ])
  const [record] = registry.get(plugins)
  const controller = registry.required(record.service)
  await expect(controller.enable()).rejects.toBe(failure)
  expect(controller.active.value).toBe(false)
  expect(registry.required(record.service)).toBe(controller)
  expect(registry.get(plugins)).toHaveLength(1)
  await registry.dispose()
})

it('exposes active state as a readonly live signal', async () => {
  const registry = new Registry()
  await registry.configure([createPlugin({ ...info, items: [] })])
  const [record] = registry.get(plugins)
  const controller = registry.required(record.service)
  expect(Reflect.set(controller.active, 'value', false)).toBe(false)
  expect(controller.active.value).toBe(true)
  await controller.disable()
  expect(controller.active.value).toBe(false)
  await registry.dispose()
})

it('selects the first plugin with a repeated ID before acquiring the discarded definition', async () => {
  const registry = new Registry()
  const commands = new Facet('commands', (values: readonly string[]) => values)
  const discarded: Extension = extension({
    create: () => {
      throw new Error('Discarded plugin must not acquire')
    },
  })
  await registry.configure([
    createPlugin({ ...info, items: [contribute(commands, () => 'first')] }),
    createPlugin({ ...info, title: 'Discarded', items: [discarded] }),
  ])
  const records = registry.get(plugins)
  expect(records).toHaveLength(1)
  expect(records[0].title).toBe(info.title)
  expect(registry.get(commands)).toEqual(['first'])
  await registry.required(records[0].service).disable()
  expect(registry.get(commands)).toEqual([])
  expect(registry.get(plugins)).toHaveLength(1)
  await registry.dispose()
})
