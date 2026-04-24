import { describe, expect, it, vi } from 'vitest'
import {
  createLineApiObject,
  createMockRustContext,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { applyOrEquipConstraintToolFromToolbar } from '@src/machines/sketchSolve/tools/constraintToolbarAction'

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
      defaultLengthUnit: 'Mm',
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
      defaultLengthUnit: 'Mm',
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
})
