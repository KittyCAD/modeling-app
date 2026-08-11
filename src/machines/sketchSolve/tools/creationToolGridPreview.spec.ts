import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { KclManager } from '@src/lang/KclManager'
import type RustContext from '@src/lib/rustContext'
import { segmentUtilsMap } from '@src/machines/sketchSolve/segments'
import {
  animateArcEndPointListener as animateCenterArcEndPoint,
  type ToolActionArgs as CenterArcToolActionArgs,
  showRadiusPreviewListener as showCenterArcRadiusPreview,
} from '@src/machines/sketchSolve/tools/centerArcToolImpl'
import {
  type ToolActionArgs as CircleToolActionArgs,
  showRadiusPreviewListener as showCircleRadiusPreview,
} from '@src/machines/sketchSolve/tools/circleToolImpl'
import { createSceneGraphDelta } from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import {
  animateArcEndPointListener as animateTangentialArcEndPoint,
  type ToolActionArgs as TangentialArcToolActionArgs,
} from '@src/machines/sketchSolve/tools/tangentialArcToolImpl'
import {
  animateArcEndPointListener as animateThreePointArcEndPoint,
  type ToolActionArgs as ThreePointArcToolActionArgs,
} from '@src/machines/sketchSolve/tools/threePointArcToolImpl'
import {
  getBestSnappingCandidate,
  updateToolSnappingPreview,
} from '@src/machines/sketchSolve/tools/toolSnappingUtils'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/settings/settingsUtils', () => ({
  jsAppSettings: () => ({}),
}))

vi.mock('@rust/kcl-wasm-lib/pkg/kcl_wasm_lib', () => ({
  calculate_circle_from_3_points: () => ({
    center_x: 1,
    center_y: 0,
    radius: 1,
  }),
}))

vi.mock('@src/machines/sketchSolve/tools/toolSnappingUtils', () => ({
  clearToolSnappingState: vi.fn(),
  getBestSnappingCandidate: vi.fn(() => ({
    target: { type: 'grid' },
    distance: 0,
    position: [2, 2],
  })),
  sendHoveredSnappingCandidate: vi.fn(),
  updateToolSnappingPreview: vi.fn(),
}))

type MoveCallback = (args: {
  intersectionPoint: { twoD: { x: number; y: number } }
  mouseEvent: MouseEvent
}) => void | Promise<void>
type ClickCallback = (args: {
  intersectionPoint: { twoD: { x: number; y: number } }
  mouseEvent: MouseEvent
}) => void

function createListenerSceneInfra() {
  let onMove: MoveCallback | undefined
  let onClick: ClickCallback | undefined
  const sceneInfra = {
    setCallbacks: vi.fn(
      (callbacks: { onMove: MoveCallback; onClick?: ClickCallback }) => {
        onMove = callbacks.onMove
        onClick = callbacks.onClick
      }
    ),
    scene: {
      getObjectByName: vi.fn(() => null),
    },
  } as unknown as SceneInfra

  return {
    sceneInfra,
    getOnMove: () => onMove,
    getOnClick: () => onClick,
  }
}

function createToolSelf() {
  return {
    send: vi.fn(),
    _parent: {
      send: vi.fn(),
    },
  }
}

function createEditingContext() {
  const editSegments = vi.fn().mockResolvedValue({
    kclSource: { text: 'updated' },
    sceneGraphDelta: createSceneGraphDelta([]),
  })

  return {
    editSegments,
    rustContext: {
      editSegments,
      settingsActor: {},
    } as unknown as RustContext,
    kclManager: {
      fileSettings: { defaultLengthUnit: 'Mm' },
    } as unknown as KclManager,
  }
}

function moveEvent(x = 9, y = 4) {
  return {
    intersectionPoint: { twoD: { x, y } },
    mouseEvent: new MouseEvent('mousemove'),
  }
}

function getArcCtor(editSegments: ReturnType<typeof vi.fn>) {
  return editSegments.mock.calls[0][2][0].ctor
}

function getArcEndpoints(ctor: ReturnType<typeof getArcCtor>) {
  return [
    [ctor.start.x.value, ctor.start.y.value],
    [ctor.end.x.value, ctor.end.y.value],
  ]
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('creation tool grid previews', () => {
  it('uses the snapped point for the circle radius preview', async () => {
    const { sceneInfra, getOnMove } = createListenerSceneInfra()
    const updatePreviewCircle = vi
      .spyOn(segmentUtilsMap.ArcSegment, 'updatePreviewCircle')
      .mockImplementation(() => {})

    showCircleRadiusPreview({
      self: createToolSelf(),
      context: {
        centerPoint: [0, 0],
        sceneInfra,
        sketchId: 0,
      },
    } as unknown as CircleToolActionArgs)

    await getOnMove()?.(moveEvent())

    expect(updatePreviewCircle).toHaveBeenCalledWith({
      sceneInfra,
      center: [0, 0],
      radius: Math.sqrt(8),
    })
  })

  it('uses the snapped point for the center-arc radius preview', async () => {
    const { sceneInfra, getOnMove } = createListenerSceneInfra()
    const updatePreviewCircle = vi
      .spyOn(segmentUtilsMap.ArcSegment, 'updatePreviewCircle')
      .mockImplementation(() => {})

    showCenterArcRadiusPreview({
      self: createToolSelf(),
      context: {
        centerPoint: [0, 0],
        sceneInfra,
        sketchId: 0,
      },
    } as unknown as CenterArcToolActionArgs)

    await getOnMove()?.(moveEvent())

    expect(updatePreviewCircle).toHaveBeenCalledWith({
      sceneInfra,
      center: [0, 0],
      radius: Math.sqrt(8),
    })
  })

  it('does not advertise a grid point that the fixed-radius center arc cannot reach', async () => {
    const { sceneInfra, getOnMove, getOnClick } = createListenerSceneInfra()
    const { editSegments, rustContext, kclManager } = createEditingContext()
    const self = createToolSelf()

    animateCenterArcEndPoint({
      self,
      context: {
        arcId: 7,
        centerPoint: [0, 0],
        arcStartPoint: [10, 0],
        sceneInfra,
        rustContext,
        kclManager,
        sketchId: 0,
      },
    } as unknown as CenterArcToolActionArgs)

    await getOnMove()?.(moveEvent())

    expect(getArcEndpoints(getArcCtor(editSegments))).toContainEqual([
      9.14, 4.06,
    ])
    expect(updateToolSnappingPreview).toHaveBeenLastCalledWith({
      sceneInfra,
      target: null,
    })

    getOnClick()?.({
      ...moveEvent(),
      mouseEvent: { which: 1 } as MouseEvent,
    })

    expect(self.send).toHaveBeenLastCalledWith({
      type: 'add point',
      data: [9, 4],
      clickNumber: 3,
      snapTarget: undefined,
    })
  })

  it('preserves geometric snapping for the fixed-radius center arc', async () => {
    const { sceneInfra, getOnMove } = createListenerSceneInfra()
    const { editSegments, rustContext, kclManager } = createEditingContext()
    const pointCandidate = {
      target: { type: 'point' as const, id: 99 },
      distance: 0,
      position: [2, 2] as [number, number],
    }
    vi.mocked(getBestSnappingCandidate).mockReturnValueOnce(pointCandidate)

    animateCenterArcEndPoint({
      self: createToolSelf(),
      context: {
        arcId: 7,
        centerPoint: [0, 0],
        arcStartPoint: [10, 0],
        sceneInfra,
        rustContext,
        kclManager,
        sketchId: 0,
      },
    } as unknown as CenterArcToolActionArgs)

    await getOnMove()?.(moveEvent())

    expect(getArcEndpoints(getArcCtor(editSegments))).toContainEqual([
      7.07, 7.07,
    ])
    expect(updateToolSnappingPreview).toHaveBeenLastCalledWith({
      sceneInfra,
      target: pointCandidate,
    })
  })

  it('uses the snapped endpoint for the three-point arc preview', async () => {
    const { sceneInfra, getOnMove } = createListenerSceneInfra()
    const { editSegments, rustContext, kclManager } = createEditingContext()

    animateThreePointArcEndPoint({
      self: createToolSelf(),
      context: {
        arcId: 7,
        startPoint: [0, 0],
        throughPoint: [1, 1],
        sceneInfra,
        rustContext,
        kclManager,
        sketchId: 0,
      },
    } as unknown as ThreePointArcToolActionArgs)

    await getOnMove()?.(moveEvent())

    expect(getArcEndpoints(getArcCtor(editSegments))).toContainEqual([2, 2])
  })

  it('uses the snapped endpoint for the tangential-arc preview', async () => {
    const { sceneInfra, getOnMove } = createListenerSceneInfra()
    const { editSegments, rustContext, kclManager } = createEditingContext()

    animateTangentialArcEndPoint({
      self: createToolSelf(),
      context: {
        arcId: 7,
        tangentInfo: {
          ownerId: 1,
          tangentStart: { pointId: 2, position: [0, 0] },
          tangentDirection: [1, 0],
        },
        sceneInfra,
        rustContext,
        kclManager,
        sketchId: 0,
      },
    } as unknown as TangentialArcToolActionArgs)

    await getOnMove()?.(moveEvent())

    expect(getArcEndpoints(getArcCtor(editSegments))).toContainEqual([2, 2])
  })
})
