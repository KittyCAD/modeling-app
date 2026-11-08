import { signal } from '@preact/signals-core'
import { expect, it } from 'vitest'
import {
  contribute,
  createScope,
  Facet,
  provide,
  type Subtree,
  service,
  slot,
} from './algebra'
import { DependencyCycleError } from './planner'
import { Reconciler } from './reconciler'

it('keeps returned service observations live across provider replacement', async () => {
  const reconciler = new Reconciler()
  const token = service<{ value: number }>('value')
  const first = { value: 1 }
  const second = { value: 2 }
  const providers = slot([provide(token, first)])
  await reconciler.configure([providers])
  const observed = reconciler.observe(token)
  const scope = createScope({ id: 'consumer', path: 'consumer' }, reconciler)
  expect(scope.required(token)).toBe(first)
  await scope.replace(providers, [provide(token, second)])
  expect(observed.value).toEqual({ kind: 'ready', value: second })
  expect(scope.required(token)).toBe(second)
  await reconciler.configure([])
  expect(observed.value).toEqual({ kind: 'missing' })
})

it('waits for children before releasing their owner and rejects overlapping mutations', async () => {
  const reconciler = new Reconciler()
  const events: string[] = []
  let finish: () => void = () => {
    throw new Error('Cleanup was not started')
  }
  const child: Subtree = {
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
  }
  const owner: Subtree = {
    create: () => ({
      items: [child],
      dispose: () => {
        events.push('owner')
      },
    }),
  }
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
  const reconciler = new Reconciler()
  const facet = new Facet('values', (values: readonly number[]) => values)
  const failure = new Error('cleanup failed')
  const released: string[] = []
  const child: Subtree = {
    create: () => ({
      items: [],
      dispose: () => {
        released.push('child')
        throw failure
      },
    }),
  }
  const owner: Subtree = {
    create: () => ({
      items: [child],
      dispose: () => {
        released.push('owner')
      },
    }),
  }
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
  const reconciler = new Reconciler()
  const facet = new Facet('values', (values: readonly number[]) => values)
  await reconciler.configure([contribute(facet, () => 3)])
  const acquisitionFailure = new Error('acquisition failed')
  const cleanupFailure = new Error('cleanup failed')
  const released: string[] = []
  const good: Subtree = {
    create: () => ({
      items: [],
      dispose: () => {
        released.push('good')
      },
    }),
  }
  const badCleanup: Subtree = {
    create: () => ({
      items: [],
      dispose: async () => {
        released.push('bad')
        throw cleanupFailure
      },
    }),
  }
  const badAcquire: Subtree = {
    create: () => {
      throw acquisitionFailure
    },
  }
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
  const reconciler = new Reconciler()
  let acquired = 0
  let disposed = 0
  const dependencies: Subtree[] = []
  const declared: Subtree = {
    dependencies,
    create: () => {
      acquired++
      return { items: [] }
    },
  }
  dependencies.push(declared)
  await expect(reconciler.configure([declared])).rejects.toBeInstanceOf(
    DependencyCycleError
  )
  expect(acquired).toBe(0)

  const dynamic: Subtree = {
    create: () => {
      acquired++
      return {
        items: [dynamic],
        dispose: () => {
          disposed++
        },
      }
    },
  }
  await expect(reconciler.configure([dynamic])).rejects.toBeInstanceOf(
    DependencyCycleError
  )
  expect(acquired).toBe(1)
  expect(disposed).toBe(1)
  await reconciler.configure([])
  expect(disposed).toBe(1)
})

it('rolls back binding installation failures and forbids eager reads during acquisition', async () => {
  const reconciler = new Reconciler()
  const facet = new Facet('values', (values: readonly number[]) => values)
  const current = signal(1)
  await reconciler.configure([contribute(facet, () => current.value)])
  let disposed = 0
  const owner: Subtree = {
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
  }
  await expect(reconciler.configure([owner])).rejects.toThrow(
    'installation failed'
  )
  expect(disposed).toBe(1)
  const eager: Subtree = {
    create: (scope) => {
      void scope.observe(facet).value
      return { items: [] }
    },
  }
  await expect(reconciler.configure([eager])).rejects.toThrow(
    'Defer observations'
  )
  current.value = 2
  expect(reconciler.observe(facet).value).toEqual([2])
  await expect(reconciler.replace(owner, [])).rejects.toThrow('unmounted')
  await reconciler.configure([])
})

it('registers service provenance under its acquiring owner', async () => {
  const reconciler = new Reconciler()
  const token = service<{ value: number }>('value')
  const owner: Subtree = {
    create: (scope) => ({
      items: [provide(token, { value: 1 }), provide(token, { value: 2 })],
      dispose: () => {
        expect(scope.origin.path).toBe('root[0]')
      },
    }),
  }
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
  const reconciler = new Reconciler()
  let disposed = 0
  const owner: Subtree = {
    create: () => ({
      get items(): readonly [] {
        throw new Error('children failed')
      },
      dispose: () => {
        disposed++
      },
    }),
  }
  await expect(reconciler.configure([owner])).rejects.toThrow('children failed')
  expect(disposed).toBe(1)
})

it('keeps sources lazy and detaches removed sources across typed cells', async () => {
  const reconciler = new Reconciler()
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
  const reconciler = new Reconciler()
  const facet = new Facet('values', (values: readonly number[]) => values)
  const observed = reconciler.observe(facet)
  const failure = new Error('failed after registration')
  await expect(
    reconciler.configure([
      contribute(facet, () => 1),
      {
        create: () => {
          throw failure
        },
      },
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
