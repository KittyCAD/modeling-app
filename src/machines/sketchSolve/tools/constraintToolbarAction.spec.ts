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
    const addConstraintsMock = vi.spyOn(rustContext, 'addConstraints')
    const equipConstraintTool = vi.fn()

    addConstraintsMock.mockResolvedValue({
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
    expect(addConstraintsMock).toHaveBeenCalledWith(
      0,
      0,
      [
        {
          type: 'Horizontal',
          line: 10,
        },
      ],
      {},
      true
    )
    expect(equipConstraintTool).not.toHaveBeenCalled()
  })

  it('applies coincident pairwise to preselected lines instead of equipping the tool', async () => {
    const pointA = createPointApiObject({ id: 1 })
    const pointB = createPointApiObject({ id: 2 })
    const pointC = createPointApiObject({ id: 3 })
    const pointD = createPointApiObject({ id: 4 })
    const pointE = createPointApiObject({ id: 5 })
    const pointF = createPointApiObject({ id: 6 })
    const lineA = createLineApiObject({ id: 10, start: 1, end: 2 })
    const lineB = createLineApiObject({ id: 11, start: 3, end: 4 })
    const lineC = createLineApiObject({ id: 12, start: 5, end: 6 })
    const sceneGraphDelta = createSceneGraphDelta([
      pointA,
      pointB,
      pointC,
      pointD,
      pointE,
      pointF,
      lineA,
      lineB,
      lineC,
    ])
    const rustContext = createMockRustContext()
    const addConstraintsMock = vi.spyOn(rustContext, 'addConstraints')
    const equipConstraintTool = vi.fn()

    addConstraintsMock.mockResolvedValue({
      kclSource: { text: 'coincident' },
      sceneGraphDelta,
      checkpointId: 1,
    })

    const result = await applyOrEquipConstraintToolFromToolbar({
      toolName: 'coincidentConstraintTool',
      selectedIds: [10, 11, 12],
      objects: sceneGraphDelta.new_graph.objects,
      rustContext,
      sketchId: 0,
      settings: {},
      equipConstraintTool,
    })

    expect(result).toMatchObject({
      type: 'applied',
      toolName: 'coincidentConstraintTool',
    })
    expect(addConstraintsMock).toHaveBeenCalledTimes(1)
    expect(addConstraintsMock).toHaveBeenCalledWith(
      0,
      0,
      [
        {
          type: 'Coincident',
          segments: [10, 11],
        },
        {
          type: 'Coincident',
          segments: [10, 12],
        },
      ],
      {},
      true
    )
    expect(equipConstraintTool).not.toHaveBeenCalled()
  })

  it('equips the tool instead of applying when the current selection is invalid', async () => {
    const point = createPointApiObject({ id: 1 })
    const objects = createSceneGraphDelta([point]).new_graph.objects
    const rustContext = createMockRustContext()
    const addConstraintsMock = vi.spyOn(rustContext, 'addConstraints')
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
    expect(addConstraintsMock).not.toHaveBeenCalled()
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
    const addConstraintsMock = vi.spyOn(rustContext, 'addConstraints')
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
    expect(addConstraintsMock).not.toHaveBeenCalled()
    expect(equipConstraintTool).toHaveBeenCalledWith('symmetricConstraintTool')
  })
})
