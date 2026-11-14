import type { EntityReference } from '@kittycad/lib'
import { signal } from '@preact/signals-core'
import {
  createSceneSelection,
  type PickingArgument,
  type SceneSelection,
  type SelectionAdapter,
} from '@src/lib/scene/selection'
import fc from 'fast-check'
import { expect, it, vi } from 'vitest'

const region = (id: string): EntityReference => ({
  type: 'region',
  region_id: id,
})
function model() {
  return { sceneId: Symbol('scene'), executionId: Symbol('execution') }
}
function setup() {
  const adapter = {
    pick: vi.fn<SelectionAdapter['pick']>(async ({ clientX }) => ({
      reference: region(String(clientX)),
    })),
    present: vi.fn<SelectionAdapter['present']>(async () => {}),
  }
  const selection = createSceneSelection(adapter, ['region'])
  selection.setModel(model())
  return {
    adapter,
    selection,
    pick: (id: number, additive = false) =>
      selection.pick({ clientX: id, clientY: 0 }, additive),
  }
}
function profiles() {
  const value = signal<readonly SceneSelection[]>([])
  return {
    id: 'profiles',
    filter: ['region'],
    multiple: true,
    value,
    accepts: (reference) => reference.type === 'region',
    setValue: (next) => {
      value.value = next
    },
  } satisfies PickingArgument
}
function requireValue<T>(value: T | Error): T {
  if (value instanceof Error) throw value
  return value
}

it('keeps selections independent between two views and rejects selections from another view', async () => {
  const first = setup(),
    second = setup()
  try {
    await first.pick(1)
    expect(second.selection.selected.peek()).toEqual([])
    expect(
      second.selection.validate(first.selection.selected.peek())
    ).toBeInstanceOf(Error)
    expect(first.selection.validate(first.selection.selected.peek())).toEqual([
      region('1'),
    ])
  } finally {
    first.selection.dispose()
    second.selection.dispose()
  }
})

it('routes dialog picks to the active argument, leaves view selection untouched, and drops only dialog state on cancel', async () => {
  const { selection, pick, adapter } = setup()
  try {
    await pick(1)
    const original = selection.selected.peek()
    const argument = profiles()
    const dialog = requireValue(
      selection.beginPicking({ arguments: [argument], seed: 'profiles' })
    )
    expect(argument.value.peek()).toEqual(original)
    await pick(2)
    expect(adapter.pick).toHaveBeenCalledOnce()
    expect(argument.value.peek()).toEqual(original)
    expect(selection.displayed.peek()).toEqual([])
    expect(dialog.activate('profiles')).toBeUndefined()
    await pick(2, true)
    expect(argument.value.peek().map((item) => item.reference)).toEqual([
      region('1'),
      region('2'),
    ])
    expect(selection.displayed.peek()).toEqual(argument.value.peek())
    expect(selection.selected.peek()).toBe(original)
    dialog.activate(null)
    await pick(3)
    expect(adapter.pick).toHaveBeenCalledTimes(2)
    expect(selection.selected.peek()).toBe(original)
    dialog.close()
    expect(selection.displayed.peek()).toBe(original)
    expect(selection.pickingEnabled.peek()).toBe(true)
    expect(dialog.validate(argument.value.peek())).toBeInstanceOf(Error)
  } finally {
    selection.dispose()
  }
})

it('invalidates dialog targets even when a re-execution reuses the same geometry IDs', async () => {
  const { selection, pick } = setup()
  try {
    await pick(1)
    const stale = selection.selected.peek()
    const argument = profiles()
    const dialog = requireValue(
      selection.beginPicking({ arguments: [argument], seed: 'profiles' })
    )
    dialog.activate('profiles')
    selection.invalidate()
    expect(dialog.model.peek()).toBeNull()
    expect(argument.value.peek()).toEqual([])
    expect(selection.selected.peek()).toEqual([])
    selection.setModel(model())
    expect(dialog.validate([])).toBeInstanceOf(Error)
    expect(dialog.activate('profiles')).toBeInstanceOf(Error)
    expect(selection.validate(stale)).toBeInstanceOf(Error)
    expect(dialog.bindCurrentModel()).toBeUndefined()
    dialog.activate('profiles')
    await pick(1)
    expect(dialog.validate(argument.value.peek())).toEqual([region('1')])
    expect(selection.selected.peek()).toEqual([])
  } finally {
    selection.dispose()
  }
})

it.each([
  'invalidate',
  'close dialog',
  'change argument',
  'clear',
  'dispose',
] as const)('ignores a delayed pick after %s', async (action) => {
  const { selection, pick, adapter } = setup()
  const argument = profiles()
  const dialog = requireValue(selection.beginPicking({ arguments: [argument] }))
  dialog.activate('profiles')
  const reply = Promise.withResolvers<{ reference: EntityReference }>()
  adapter.pick.mockReturnValue(reply.promise)
  const pending = pick(1)
  await vi.waitFor(() => expect(adapter.pick).toHaveBeenCalledOnce())
  if (action === 'invalidate') {
    selection.invalidate()
    selection.setModel(model())
  }
  if (action === 'close dialog') dialog.close()
  if (action === 'change argument') dialog.activate(null)
  if (action === 'clear') selection.clear()
  if (action === 'dispose') selection.dispose()
  reply.resolve({ reference: region('1') })
  await pending
  expect(argument.value.peek()).toEqual([])
  expect(selection.selected.peek()).toEqual([])
  selection.dispose()
})

it('processes rapid additive picks in order and rejects an incompatible argument hit', async () => {
  const { selection, pick, adapter } = setup()
  try {
    const argument = profiles()
    const dialog = requireValue(
      selection.beginPicking({ arguments: [argument] })
    )
    dialog.activate('profiles')
    await Promise.all([pick(1, true), pick(2, true), pick(3, true)])
    expect(dialog.validate(argument.value.peek())).toEqual([
      region('1'),
      region('2'),
      region('3'),
    ])
    adapter.pick.mockResolvedValue({
      reference: { type: 'face', face_id: 'face' },
    })
    await pick(4)
    expect(argument.value.peek()).toHaveLength(3)
  } finally {
    selection.dispose()
  }
})

it('treats opposite face order as the same selected edge and preserves topology metadata', async () => {
  const { selection, pick, adapter } = setup()
  try {
    adapter.pick.mockResolvedValueOnce({
      reference: { type: 'edge', side_faces: ['left', 'right'] },
    })
    await pick(1)
    adapter.pick.mockResolvedValueOnce({
      reference: { type: 'edge', side_faces: ['right', 'left'] },
    })
    await pick(1, true)
    expect(selection.selected.peek()).toEqual([])
    const reference: EntityReference = {
      type: 'face',
      face_id: 'face',
      topology_fallback: { parent_id: 'body', primitive_index: 2 },
    }
    adapter.pick.mockResolvedValueOnce({ reference })
    await pick(2)
    expect(selection.validate(selection.selected.peek())).toEqual([reference])
    reference.face_id = 'mutated after reply'
    expect(selection.selected.peek()[0].reference).toMatchObject({
      face_id: 'face',
    })
  } finally {
    selection.dispose()
  }
})

it('matches an independent selection model across replacement, toggling, clearing and re-execution', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          kind: fc.constantFrom('single', 'toggle', 'clear', 'execute'),
          id: fc.integer({ min: 0, max: 5 }),
        }),
        { maxLength: 30 }
      ),
      async (operations) => {
        const { selection, pick } = setup()
        let expected: number[] = []
        try {
          for (const { kind, id } of operations) {
            if (kind === 'single') {
              expected = [id]
              await pick(id)
            } else if (kind === 'toggle') {
              expected = expected.includes(id)
                ? expected.filter((value) => value !== id)
                : [...expected, id]
              await pick(id, true)
            } else if (kind === 'clear') {
              expected = []
              selection.clear()
            } else {
              expected = []
              selection.setModel(model())
            }
            expect(
              selection.selected.peek().map((item) => item.reference)
            ).toEqual(expected.map((value) => region(String(value))))
          }
        } finally {
          selection.dispose()
        }
      }
    ),
    { numRuns: 40 }
  )
})

it('lets a new execution accept picks while an old point query is still pending', async () => {
  const { selection, pick, adapter } = setup()
  const reply = Promise.withResolvers<{ reference: EntityReference }>()
  adapter.pick.mockReturnValueOnce(reply.promise)
  const stale = pick(1)
  try {
    await vi.waitFor(() => expect(adapter.pick).toHaveBeenCalledOnce())
    selection.setModel(model())
    const current = pick(2)
    await vi.waitFor(() =>
      expect(selection.validate(selection.selected.peek())).toEqual([
        region('2'),
      ])
    )
    await current
  } finally {
    reply.resolve({ reference: region('1') })
    await stale
    selection.dispose()
  }
})

it('changes only its own view filter and clears its selections, while a dialog retains ownership', async () => {
  const first = setup(),
    second = setup()
  try {
    await first.pick(1)
    expect(first.selection.setFilter(['face'])).toBeUndefined()
    expect(first.selection.filter.peek()).toEqual(['face'])
    expect(first.selection.selected.peek()).toEqual([])
    expect(second.selection.filter.peek()).toEqual(['region'])
    const dialog = requireValue(
      first.selection.beginPicking({
        arguments: [profiles()],
        seed: 'profiles',
      })
    )
    expect(first.selection.setFilter(['edge'])).toBeInstanceOf(Error)
    dialog.close()
    expect(first.selection.filter.peek()).toEqual(['face'])
  } finally {
    first.selection.dispose()
    second.selection.dispose()
  }
})
