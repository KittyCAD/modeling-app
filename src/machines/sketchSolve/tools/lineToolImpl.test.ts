import {
  animateDraftSegmentListener,
  type ToolActionArgs,
} from '@src/machines/sketchSolve/tools/lineToolImpl'
import {
  createMockKclManager,
  createMockRustContext,
  createMockSceneInfra,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { Vector2 } from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/settings/settingsUtils', () => ({
  jsAppSettings: () => ({}),
}))

vi.mock('@src/machines/sketchSolve/tools/toolSnappingUtils', () => ({
  clearToolSnappingState: vi.fn(),
  getBestSnappingCandidate: vi.fn(() => ({
    target: { type: 'grid' },
    distance: 0,
    position: [20.25, 30.5],
  })),
  sendHoveredSnappingCandidate: vi.fn(),
  updateToolSnappingPreview: vi.fn(),
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('animateDraftSegmentListener', () => {
  it('moves the line draft point to the snapped grid position', async () => {
    let onMove: ((args: unknown) => Promise<void>) | undefined
    const sceneInfra = createMockSceneInfra()
    vi.mocked(sceneInfra.setCallbacks).mockImplementation((callbacks) => {
      onMove = callbacks.onMove as typeof onMove
    })
    const rustContext = createMockRustContext()
    const editSegments = vi
      .spyOn(rustContext, 'editSegments')
      .mockResolvedValue({
        kclSource: { text: 'updated' },
        sceneGraphDelta: createSceneGraphDelta([]),
      })
    const self = {
      send: vi.fn(),
      _parent: {
        send: vi.fn(),
      },
    }
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })

    animateDraftSegmentListener({
      self,
      context: {
        draftPointId: 7,
        sceneInfra,
        rustContext,
        kclManager: createMockKclManager(),
        sketchId: 0,
      },
    } as unknown as ToolActionArgs)

    expect(onMove).toBeTypeOf('function')
    await onMove?.({
      intersectionPoint: {
        twoD: new Vector2(20.37, 30.62),
      },
      mouseEvent: new MouseEvent('mousemove'),
    })

    expect(editSegments).toHaveBeenCalledWith(
      0,
      0,
      [
        {
          id: 7,
          ctor: {
            type: 'Point',
            position: {
              x: { type: 'Var', value: 20.25, units: 'Mm' },
              y: { type: 'Var', value: 30.5, units: 'Mm' },
            },
          },
        },
      ],
      {}
    )
  })
})
