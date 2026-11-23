import { signal } from '@preact/signals-core'
import { attachSceneSelectionInput } from '@src/lib/kcl/scene/selectionAdapter'
import { createSceneSelection } from '@src/lib/kcl/scene/selection'
import { expect, it, vi } from 'vitest'

it('selects on primary click, ignores camera drags, and releases input on detach', async () => {
  const pick = vi.fn(async () => ({
    reference: { type: 'region' as const, region_id: 'profile' },
  }))
  const selection = createSceneSelection({ pick, present: async () => {} }, [
    'region',
  ])
  selection.setModel({ sceneId: Symbol(), executionId: Symbol() })
  const canvas = document.createElement('canvas')
  const controls = { wasDragging: false, hoverPickingDisabled: false }
  const detach = attachSceneSelectionInput(canvas, controls, selection)
  try {
    canvas.dispatchEvent(
      new PointerEvent('pointerup', { button: 0, clientX: 20, clientY: 30 })
    )
    await vi.waitFor(() => expect(selection.selected.peek()).toHaveLength(1))
    controls.wasDragging = true
    canvas.dispatchEvent(new PointerEvent('pointerup', { button: 0 }))
    controls.wasDragging = false
    canvas.dispatchEvent(new PointerEvent('pointerup', { button: 2 }))
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(selection.selected.peek()).toEqual([])
    expect(pick).toHaveBeenCalledOnce()
    detach()
    canvas.dispatchEvent(new PointerEvent('pointerup', { button: 0 }))
    await Promise.resolve()
    expect(pick).toHaveBeenCalledOnce()
    expect(canvas.getAttribute('tabindex')).toBeNull()
  } finally {
    detach()
    selection.dispose()
  }
})

it('leaves Escape and hover owned by an open dialog', async () => {
  const selection = createSceneSelection(
    {
      pick: async () => ({
        reference: { type: 'region', region_id: 'profile' },
      }),
      present: async () => {},
    },
    ['region']
  )
  selection.setModel({ sceneId: Symbol(), executionId: Symbol() })
  await selection.pick({ clientX: 0, clientY: 0 })
  const canvas = document.createElement('canvas')
  const controls = { wasDragging: false, hoverPickingDisabled: false }
  const detach = attachSceneSelectionInput(canvas, controls, selection)
  const argument = {
    id: 'profiles',
    filter: ['region' as const],
    multiple: true,
    value: signal(selection.selected.peek()),
    accepts: () => true,
    setValue: vi.fn(),
  }
  const dialog = selection.beginPicking({ arguments: [argument] })
  if (dialog instanceof Error) throw dialog
  try {
    expect(controls.hoverPickingDisabled).toBe(true)
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(selection.selected.peek()).toHaveLength(1)
    dialog.activate('profiles')
    expect(controls.hoverPickingDisabled).toBe(false)
    dialog.close()
    expect(controls.hoverPickingDisabled).toBe(false)
  } finally {
    detach()
    selection.dispose()
  }
})
