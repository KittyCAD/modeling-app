import { applyOrEquipConstraintToolFromToolbar } from '@src/machines/sketchSolve/tools/constraintToolbarAction'
import {
  createArcApiObject,
  createCircleApiObject,
  createLineApiObject,
  createMockRustContext,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { describe, expect, it, vi } from 'vitest'

describe('constraintToolbarAction', () => {
  it('applies immediately for an already-valid selection and does not equip the tool', async () => {
    const pointA = createPointApiObject({ id: 1 })
    const pointB = createPointApiObject({ id: 2 })
    const line = createLineApiObject({ id: 10, start: 1, end: 2 })
    const objects = createSceneGraphDelta([pointA, pointB, line]).new_graph
      .objects
    const rustContext = createMockRustContext()
    const addConstraintMock = vi.spyOn(rustContext, 'addConstraint')
    const equipConstraintTool = vi.fn()

    addConstraintMock.mockResolvedValue({
      kclSource: { text: 'horizontal' },
      sceneGraphDelta: createSceneGraphDelta([pointA, pointB, line]),
      checkpointId: 1,
    })

    const result = await applyOrEquipConstraintToolFromToolbar({
      toolName: 'horizontalConstraintTool',
      selectedIds: [10],
      objects,
      rustContext,
      sketchId: 0,
      settings: {},
      equipConstraintTool,
    })

    expect(result).toMatchObject({
      type: 'applied',
      toolName: 'horizontalConstraintTool',
    })
    expect(addConstraintMock).toHaveBeenCalledWith(
      0,
      0,
      {
        type: 'Horizontal',
        line: 10,
      },
      {},
      true
    )
    expect(equipConstraintTool).not.toHaveBeenCalled()
  })

  it('equips the tool instead of applying when the current selection is invalid', async () => {
    const point = createPointApiObject({ id: 1 })
    const objects = createSceneGraphDelta([point]).new_graph.objects
    const rustContext = createMockRustContext()
    const addConstraintMock = vi.spyOn(rustContext, 'addConstraint')
    const equipConstraintTool = vi.fn()

    const result = await applyOrEquipConstraintToolFromToolbar({
      toolName: 'horizontalConstraintTool',
      selectedIds: [1],
      objects,
      rustContext,
      sketchId: 0,
      settings: {},
      equipConstraintTool,
    })

    expect(result).toEqual({
      type: 'equipped',
      toolName: 'horizontalConstraintTool',
    })
    expect(equipConstraintTool).toHaveBeenCalledWith('horizontalConstraintTool')
    expect(addConstraintMock).not.toHaveBeenCalled()
  })

  it('equips symmetric instead of auto-applying so the axis can be confirmed explicitly', async () => {
    const centerA = createPointApiObject({ id: 1 })
    const startA = createPointApiObject({ id: 2 })
    const endA = createPointApiObject({ id: 3 })
    const centerB = createPointApiObject({ id: 4 })
    const startB = createPointApiObject({ id: 5 })
    const axisStart = createPointApiObject({ id: 6 })
    const axisEnd = createPointApiObject({ id: 7 })
    const arc = createArcApiObject({ id: 10, center: 1, start: 2, end: 3 })
    const circle = createCircleApiObject({ id: 11, center: 4, start: 5 })
    const axis = createLineApiObject({ id: 12, start: 6, end: 7 })
    const objects = createSceneGraphDelta([
      centerA,
      startA,
      endA,
      centerB,
      startB,
      axisStart,
      axisEnd,
      arc,
      circle,
      axis,
    ]).new_graph.objects
    const rustContext = createMockRustContext()
    const addConstraintMock = vi.spyOn(rustContext, 'addConstraint')
    const equipConstraintTool = vi.fn()

    const result = await applyOrEquipConstraintToolFromToolbar({
      toolName: 'symmetricConstraintTool',
      selectedIds: [10, 12, 11],
      objects,
      rustContext,
      sketchId: 0,
      settings: {},
      equipConstraintTool,
    })

    expect(result).toMatchObject({
      type: 'equipped',
      toolName: 'symmetricConstraintTool',
    })
    expect(addConstraintMock).not.toHaveBeenCalled()
    expect(equipConstraintTool).toHaveBeenCalledWith('symmetricConstraintTool')
  })
})
