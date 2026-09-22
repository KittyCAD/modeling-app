import {
  animateArcEndPointListener as animateCenterArcEndPoint,
  type ToolActionArgs as CenterArcToolActionArgs,
} from '@src/machines/sketchSolve/tools/centerArcToolImpl'
import {
  createMockKclManager,
  createMockRustContext,
  createMockSceneInfra,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import {
  getBestSnappingCandidate,
  updateToolSnappingPreview,
} from '@src/machines/sketchSolve/tools/toolSnappingUtils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/settings/settingsUtils', () => ({
  jsAppSettings: () => ({}),
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
  const sceneInfra = createMockSceneInfra()
  vi.mocked(sceneInfra.setCallbacks).mockImplementation((callbacks) => {
    onMove = callbacks.onMove as MoveCallback | undefined
    onClick = callbacks.onClick as ClickCallback | undefined
  })

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
  const rustContext = createMockRustContext()
  const editSegments = vi.spyOn(rustContext, 'editSegments').mockResolvedValue({
    kclSource: { text: 'updated' },
    sceneGraphDelta: createSceneGraphDelta([]),
  })

  return {
    editSegments,
    rustContext,
    kclManager: createMockKclManager(),
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('center arc grid preview', () => {
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
})
