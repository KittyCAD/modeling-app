import { signal } from '@preact/signals-core'
import { expect, it } from 'vitest'
import { modelingTestContext } from '@src/lib/kcl/testContext'
import type { ModelingInteractionSession } from '@src/lib/kcl/interactions'
import type {
  SelectionSource,
  ActiveSelectionItem,
} from '@src/lib/kcl/selection'
import type { SceneSelection } from '@src/lib/scene/selection'

it('reads and clears the active owner without clearing the underlying view or a sibling view', async () => {
  const first = modelingTestContext(),
    second = modelingTestContext()
  try {
    await first.resource.selection.pick({ clientX: 1, clientY: 0 })
    await second.resource.selection.pick({ clientX: 2, clientY: 0 })
    const selected = signal<readonly ActiveSelectionItem[]>([
      { kind: 'sketch', sessionId: Symbol(), sketchId: 10, id: 7 },
    ])
    const source: SelectionSource = {
      items: selected,
      canClear: signal(true),
      clear: () => {
        selected.value = []
      },
    }
    const interaction: ModelingInteractionSession = {
      id: 'test.sketch',
      selection: signal(source),
      toolbar: signal([]),
      prompt: signal(''),
      defaultPlanes: signal({ xy: false, xz: false, yz: false }),
      error: signal(undefined),
      escape: async () => {},
      dispose: async () => {},
    }
    first.context.interactions.active.value = interaction
    expect(first.context.selection.items.peek()).toEqual([
      expect.objectContaining({ kind: 'sketch', id: 7 }),
    ])
    first.context.selection.clear()
    expect(first.context.selection.items.peek()).toEqual([])
    expect(first.resource.selection.selected.peek()).toHaveLength(1)
    expect(second.context.selection.items.peek()).toHaveLength(1)
    first.context.interactions.active.value = undefined
    expect(first.context.selection.items.peek()).toEqual([
      { kind: 'model', value: first.resource.selection.selected.peek()[0] },
    ])
    first.context.selection.clear()
    expect(first.resource.selection.selected.peek()).toEqual([])
    expect(second.resource.selection.selected.peek()).toHaveLength(1)
  } finally {
    first.dispose()
    second.dispose()
  }
})

it('displays dialog arguments and restores ordinary selection when picking closes', async () => {
  const view = modelingTestContext()
  try {
    await view.resource.selection.pick({ clientX: 1, clientY: 0 })
    const value = signal<readonly SceneSelection[]>([])
    const picking = view.resource.selection.beginPicking({
      arguments: [
        {
          id: 'profiles',
          filter: ['region'],
          multiple: true,
          value,
          accepts: () => true,
          setValue: (next) => {
            value.value = next
          },
        },
      ],
    })
    if (picking instanceof Error) throw picking
    picking.activate('profiles')
    await view.resource.selection.pick({ clientX: 2, clientY: 0 })
    expect(view.context.selection.items.peek()).toEqual([
      expect.objectContaining({
        value: expect.objectContaining({
          reference: { type: 'region', region_id: '2' },
        }),
      }),
    ])
    view.context.selection.clear()
    expect(value.peek()).toEqual([])
    picking.close()
    expect(view.context.selection.items.peek()).toHaveLength(1)
    view.resource.selection.invalidate()
    expect(view.context.selection.items.peek()).toEqual([])
  } finally {
    view.dispose()
  }
})
