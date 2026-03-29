import { describe, expect, it, vi } from 'vitest'
import type { ApiObject, SourceDelta } from '@rust/kcl-lib/bindings/FrontendApi'
import { animateDraftSegmentListener } from '@src/machines/sketchSolve/tools/lineToolImpl'
import {
  createMockKclManager,
  createMockRustContext,
  createMockSceneInfra,
  createPointApiObject,
  createSceneGraphDelta,
} from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { Group } from 'three'
import { SKETCH_SOLVE_GROUP } from '@src/clientSideScene/sceneUtils'
import { SKETCH_SOLVE_SNAPPING_PREVIEW_SPRITE } from '@src/machines/sketchSolve/snappingPreviewSprite'

function createSketchApiObject({ id }: { id: number }): ApiObject {
  return {
    id,
    kind: {
      type: 'Sketch',
      args: { on: { default: 'xy' } },
      plane: 0,
      segments: [],
      constraints: [],
    },
    label: '',
    comments: '',
    artifact_id: '0',
    source: { type: 'Simple', range: [0, 0, 0] },
  }
}

describe('lineToolImpl', () => {
  it('highlights the closest snap target and previews the snapped point position', async () => {
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0)
      return 0
    }) as typeof requestAnimationFrame

    try {
      const sceneInfra = createMockSceneInfra()
      const rustContext = createMockRustContext()
      const kclManager = createMockKclManager()
      const parentSend = vi.fn()
      const toolSend = vi.fn()
      const sketchSolveGroup = new Group()
      sketchSolveGroup.name = SKETCH_SOLVE_GROUP
      ;(sceneInfra.scene.getObjectByName as any).mockImplementation(
        (name: string) =>
          name === SKETCH_SOLVE_GROUP ? sketchSolveGroup : null
      )

      const sketch = createSketchApiObject({ id: 0 })
      const startPoint = createPointApiObject({ id: 1, x: 0, y: 0 })
      const draftPoint = createPointApiObject({ id: 2, x: 2, y: 2 })
      const snapTarget = createPointApiObject({ id: 3, x: 10, y: 10 })
      const sceneGraphDelta = createSceneGraphDelta(
        [sketch, startPoint, draftPoint, snapTarget],
        [0, 1, 2, 3]
      )
      ;(rustContext.editSegments as any).mockResolvedValue({
        kclSource: { text: 'preview' } as SourceDelta,
        sceneGraphDelta,
      })

      animateDraftSegmentListener({
        self: {
          send: toolSend,
          _parent: {
            send: parentSend,
            getSnapshot: () => ({
              context: {
                sketchId: 0,
                sketchExecOutcome: {
                  sceneGraphDelta,
                },
              },
            }),
          },
        } as any,
        context: {
          draftPointId: 2,
          sceneInfra,
          rustContext,
          kclManager,
          sketchId: 0,
        } as any,
      } as any)

      const callbacks = (sceneInfra.setCallbacks as any).mock.calls[0][0]
      await callbacks.onMove({
        intersectionPoint: {
          twoD: { x: 10.1, y: 10.2 },
        },
      })

      expect(parentSend).toHaveBeenCalledWith({
        type: 'update hovered id',
        data: { hoveredId: 3 },
      })
      expect((rustContext.editSegments as any).mock.calls[0]?.[0]).toBe(0)
      expect((rustContext.editSegments as any).mock.calls[0]?.[1]).toBe(0)
      expect((rustContext.editSegments as any).mock.calls[0]?.[2]).toEqual([
        {
          id: 2,
          ctor: {
            type: 'Point',
            position: {
              x: { type: 'Var', value: 10.1, units: 'Mm' },
              y: { type: 'Var', value: 10.2, units: 'Mm' },
            },
          },
        },
      ])
      expect((rustContext.editSegments as any).mock.calls[0]?.[3]).toBeTruthy()
      expect(
        sketchSolveGroup.getObjectByName(SKETCH_SOLVE_SNAPPING_PREVIEW_SPRITE)
      ).toBeTruthy()
      expect(
        sketchSolveGroup.getObjectByName(SKETCH_SOLVE_SNAPPING_PREVIEW_SPRITE)
          ?.visible
      ).toBe(true)
    } finally {
      globalThis.requestAnimationFrame = previousRequestAnimationFrame
    }
  })

  it('uses the closest snapping candidate when finalizing the draft point', () => {
    const sceneInfra = createMockSceneInfra()
    const rustContext = createMockRustContext()
    const kclManager = createMockKclManager()
    const parentSend = vi.fn()
    const toolSend = vi.fn()

    const sketch = createSketchApiObject({ id: 0 })
    const draftPoint = createPointApiObject({ id: 2, x: 2, y: 2 })
    const snapTarget = createPointApiObject({ id: 3, x: 10, y: 10 })
    const sceneGraphDelta = createSceneGraphDelta(
      [sketch, draftPoint, snapTarget],
      [0, 2, 3]
    )

    animateDraftSegmentListener({
      self: {
        send: toolSend,
        _parent: {
          send: parentSend,
          getSnapshot: () => ({
            context: {
              sketchId: 0,
              sketchExecOutcome: {
                sceneGraphDelta,
              },
            },
          }),
        },
      } as any,
      context: {
        draftPointId: 2,
        sceneInfra,
        rustContext,
        kclManager,
        sketchId: 0,
      } as any,
    } as any)

    const callbacks = (sceneInfra.setCallbacks as any).mock.calls[0][0]
    callbacks.onClick({
      mouseEvent: { detail: 1 },
      intersectionPoint: {
        twoD: { x: 10.05, y: 10.15 },
      },
    })

    expect(toolSend).toHaveBeenCalledWith({
      type: 'add point',
      data: [10, 10],
      id: 2,
      snapTarget: { type: 'segment', id: 3 },
      isDoubleClick: false,
    })
  })

  it('uses the origin snapping candidate when it is the closest target', () => {
    const sceneInfra = createMockSceneInfra()
    const rustContext = createMockRustContext()
    const kclManager = createMockKclManager()
    const parentSend = vi.fn()
    const toolSend = vi.fn()

    const sketch = createSketchApiObject({ id: 0 })
    const draftPoint = createPointApiObject({ id: 2, x: 2, y: 2 })
    const sceneGraphDelta = createSceneGraphDelta([sketch, draftPoint], [0, 2])

    animateDraftSegmentListener({
      self: {
        send: toolSend,
        _parent: {
          send: parentSend,
          getSnapshot: () => ({
            context: {
              sketchId: 0,
              sketchExecOutcome: {
                sceneGraphDelta,
              },
            },
          }),
        },
      } as any,
      context: {
        draftPointId: 2,
        sceneInfra,
        rustContext,
        kclManager,
        sketchId: 0,
      } as any,
    } as any)

    const callbacks = (sceneInfra.setCallbacks as any).mock.calls[0][0]
    callbacks.onClick({
      mouseEvent: { detail: 1 },
      intersectionPoint: {
        twoD: { x: 0.2, y: -0.1 },
      },
    })

    expect(toolSend).toHaveBeenCalledWith({
      type: 'add point',
      data: [0, 0],
      id: 2,
      snapTarget: { type: 'origin' },
      isDoubleClick: false,
    })
  })
})
