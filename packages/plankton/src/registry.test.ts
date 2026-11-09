import { factory } from './algebra'
import { signal } from '@preact/signals-core'
import { expect, it } from 'vitest'
import {
  contribute,
  createScope,
  Facet,
  provide,
  type Factory,
  service,
  slot,
} from './algebra'
import { DependencyCycleError } from './planner'
import { Registry } from './registry'

it('keeps returned service observations live across provider replacement', async () => {
  const reconciler = new Registry()
  const token = service<{ value: number }>('value')
  const first = { value: 1 }
  const second = { value: 2 }
  const providers = slot([provide(token, first)])
  await reconciler.configure([providers])
  const scope = createScope({ id: 'consumer', path: 'consumer' }, reconciler)
  const observed = scope.observe(token)
  expect(observed.value).toEqual({ kind: 'ready', value: first })
  await scope.replace(providers, [provide(token, second)])
  expect(observed.value).toEqual({ kind: 'ready', value: second })
  await reconciler.configure([])
  expect(observed.value).toEqual({ kind: 'missing' })
})

it('waits for children before releasing their owner and rejects overlapping mutations', async () => {
  const reconciler = new Registry()
  const events: string[] = []
  let finish: () => void = () => {
    throw new Error('Cleanup was not started')
  }
  const child: Factory = factory({
    create: () => ({
      items: [],
      dispose: () => {
        events.push('child started')
        return new Promise<void>((resolve) => {
          finish = () => {
            events.push('child finished')
            resolve()
          }
        })
      },
    }),
  })
  const owner: Factory = factory({
    create: () => ({
      items: [child],
      dispose: () => {
        events.push('owner')
      },
    }),
  })
  await reconciler.configure([owner])
  const completion = reconciler.configure([])
  expect(events).toEqual(['child started'])
  await expect(reconciler.configure([owner])).rejects.toThrow(
    'already in progress'
  )
  finish()
  await completion
  expect(events).toEqual(['child started', 'child finished', 'owner'])
})

it('releases every removed resource after cleanup failures and keeps the committed graph', async () => {
  const reconciler = new Registry()
  const facet = new Facet('values', (values: readonly number[]) => values)
  const failure = new Error('cleanup failed')
  const released: string[] = []
  const child: Factory = factory({
    create: () => ({
      items: [],
      dispose: () => {
        released.push('child')
        throw failure
      },
    }),
  })
  const owner: Factory = factory({
    create: () => ({
      items: [child],
      dispose: () => {
        released.push('owner')
      },
    }),
  })
  await reconciler.configure([owner])
  const replacement = contribute(facet, () => 7)
  await expect(reconciler.configure([replacement])).rejects.toMatchObject({
    errors: [failure],
  })
  expect(released).toEqual(['child', 'owner'])
  expect(reconciler.observe(facet).value).toEqual([7])
  await reconciler.configure([])
  expect(released).toEqual(['child', 'owner'])
})

it('preserves acquisition and rollback errors while releasing all newly acquired resources', async () => {
  const reconciler = new Registry()
  const facet = new Facet('values', (values: readonly number[]) => values)
  await reconciler.configure([contribute(facet, () => 3)])
  const acquisitionFailure = new Error('acquisition failed')
  const cleanupFailure = new Error('cleanup failed')
  const released: string[] = []
  const good: Factory = factory({
    create: () => ({
      items: [],
      dispose: () => {
        released.push('good')
      },
    }),
  })
  const badCleanup: Factory = factory({
    create: () => ({
      items: [],
      dispose: async () => {
        released.push('bad')
        throw cleanupFailure
      },
    }),
  })
  const badAcquire: Factory = factory({
    create: () => {
      throw acquisitionFailure
    },
  })
  await expect(
    reconciler.configure([good, badCleanup, badAcquire])
  ).rejects.toMatchObject({
    errors: [acquisitionFailure, { errors: [cleanupFailure] }],
  })
  expect(released).toEqual(['bad', 'good'])
  expect(reconciler.observe(facet).value).toEqual([3])
  await reconciler.configure([])
})

it('rolls back dynamically discovered cycles and performs no acquisition for declared cycles', async () => {
  const reconciler = new Registry()
  let acquired = 0
  let disposed = 0
  const dependencies: Record<string, Factory> = {}
  const declared: Factory = factory({
    dependencies,
    create: () => {
      acquired++
      return { items: [] }
    },
  })
  dependencies.self = declared
  await expect(reconciler.configure([declared])).rejects.toBeInstanceOf(
    DependencyCycleError
  )
  expect(acquired).toBe(0)

  const dynamic: Factory = factory({
    create: () => {
      acquired++
      return {
        items: [dynamic],
        dispose: () => {
          disposed++
        },
      }
    },
  })
  await expect(reconciler.configure([dynamic])).rejects.toBeInstanceOf(
    DependencyCycleError
  )
  expect(acquired).toBe(1)
  expect(disposed).toBe(1)
  await reconciler.configure([])
  expect(disposed).toBe(1)
})

it('rolls back binding installation failures and forbids eager reads during acquisition', async () => {
  const reconciler = new Registry()
  const facet = new Facet('values', (values: readonly number[]) => values)
  const current = signal(1)
  await reconciler.configure([contribute(facet, () => current.value)])
  let disposed = 0
  const owner: Factory = factory({
    create: () => ({
      items: [
        {
          install: () => {
            throw new Error('installation failed')
          },
        },
      ],
      dispose: () => {
        disposed++
      },
    }),
  })
  await expect(reconciler.configure([owner])).rejects.toThrow(
    'installation failed'
  )
  expect(disposed).toBe(1)
  const eager: Factory = factory({
    create: (_dependencies, scope) => {
      void scope.observe(facet).value
      return { items: [] }
    },
  })
  await expect(reconciler.configure([eager])).rejects.toThrow(
    'Defer observations'
  )
  current.value = 2
  expect(reconciler.observe(facet).value).toEqual([2])
  await expect(reconciler.replace(owner, [])).rejects.toThrow('unmounted')
  await reconciler.configure([])
})

it('registers service provenance under its acquiring owner', async () => {
  const reconciler = new Registry()
  const token = service<{ value: number }>('value')
  const owner: Factory = factory({
    create: (_dependencies, scope) => ({
      items: [provide(token, { value: 1 }), provide(token, { value: 2 })],
      dispose: () => {
        expect(scope.origin.path).toBe('root[0]')
      },
    }),
  })
  await reconciler.configure([owner])
  const resolution = reconciler.observe(token).value
  expect(resolution.kind).toBe('conflict')
  if (resolution.kind !== 'conflict')
    throw new Error('Expected provider conflict')
  expect(resolution.providers.map(({ id, path }) => ({ id, path }))).toEqual([
    { id: 'root[0]', path: 'root[0]' },
    { id: 'root[0]', path: 'root[0]' },
  ])
  await reconciler.configure([])
})

it('rolls back a returned instance even when reading its children fails', async () => {
  const reconciler = new Registry()
  let disposed = 0
  const owner: Factory = factory({
    create: () => ({
      get items(): readonly [] {
        throw new Error('children failed')
      },
      dispose: () => {
        disposed++
      },
    }),
  })
  await expect(reconciler.configure([owner])).rejects.toThrow('children failed')
  expect(disposed).toBe(1)
})

it('keeps sources lazy and detaches removed sources across typed cells', async () => {
  const reconciler = new Registry()
  const numbers = new Facet('number', (values: readonly number[]) => values)
  const strings = new Facet('string', (values: readonly string[]) => values)
  const number = signal(1)
  const text = signal('first')
  let reads = 0
  await reconciler.configure([
    contribute(numbers, () => {
      reads++
      return number.value
    }),
    contribute(strings, () => {
      reads++
      return text.value
    }),
  ])
  const numberView = reconciler.observe(numbers)
  const stringView = reconciler.observe(strings)
  expect(reads).toBe(0)
  expect(numberView.value).toEqual([1])
  expect(stringView.value).toEqual(['first'])
  number.value = 2
  text.value = 'next'
  expect(numberView.value).toEqual([2])
  expect(stringView.value).toEqual(['next'])
  await reconciler.configure([contribute(strings, () => 'replacement')])
  const before = reads
  number.value = 3
  text.value = 'detached'
  expect(numberView.value).toEqual([])
  expect(stringView.value).toEqual(['replacement'])
  expect(reads).toBe(before)
  await reconciler.configure([])
})

it('does not reuse abandoned cell drafts in a later successful transaction', async () => {
  const reconciler = new Registry()
  const facet = new Facet('values', (values: readonly number[]) => values)
  const observed = reconciler.observe(facet)
  const failure = new Error('failed after registration')
  await expect(
    reconciler.configure([
      contribute(facet, () => 1),
      factory({
        create: () => {
          throw failure
        },
      }),
    ])
  ).rejects.toBe(failure)
  expect(observed.value).toEqual([])
  await reconciler.configure([
    contribute(facet, () => 2),
    contribute(facet, () => 3),
  ])
  expect(observed.value).toEqual([2, 3])
  await reconciler.configure([])
  expect(observed.value).toEqual([])
})

it.each([false, true])(
  'preserves publication failures when cleanup also fails: %s',
  async (cleanupFails) => {
    const reconciler = new Registry()
    const facet = new Facet('values', (values: readonly number[]) => values)
    const publication = new Error('publication failed')
    const cleanup = new Error('cleanup failed')
    let disposals = 0
    const owner: Factory = factory({
      create: () => ({
        items: [contribute(facet, () => 1)],
        dispose: () => {
          disposals++
          if (cleanupFails) throw cleanup
        },
      }),
    })
    await reconciler.configure([owner])
    let failPublication = false
    const unsubscribe = reconciler.observe(facet).subscribe(() => {
      if (failPublication) throw publication
    })
    failPublication = true
    const completion = reconciler.configure([contribute(facet, () => 2)])
    if (cleanupFails) {
      await expect(completion).rejects.toMatchObject({
        errors: [publication, { errors: [cleanup] }],
      })
    } else {
      await expect(completion).rejects.toBe(publication)
    }
    expect(disposals).toBe(1)
    expect(reconciler.observe(facet).value).toEqual([2])
    unsubscribe()
    await reconciler.configure([])
    expect(disposals).toBe(1)
  }
)

it('keeps mutations blocked until failed acquisition finishes its asynchronous rollback', async () => {
  const reconciler = new Registry()
  let finish: () => void = () => {
    throw new Error('Rollback has not started')
  }
  const acquired: Factory = factory({
    create: () => ({
      items: [],
      dispose: () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    }),
  })
  const failure = new Error('acquisition failed')
  const broken: Factory = factory({
    create: () => {
      throw failure
    },
  })
  const completion = reconciler.configure([acquired, broken])
  await expect(reconciler.configure([])).rejects.toThrow('already in progress')
  finish()
  await expect(completion).rejects.toBe(failure)
  await reconciler.configure([])
})
