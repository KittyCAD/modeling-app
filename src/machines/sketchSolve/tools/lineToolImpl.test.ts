import type { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type { KclManager } from '@src/lang/KclManager'
import type RustContext from '@src/lib/rustContext'
import {
  animateDraftSegmentListener,
  type ToolActionArgs,
} from '@src/machines/sketchSolve/tools/lineToolImpl'
import { createSceneGraphDelta } from '@src/machines/sketchSolve/tools/sketchToolTestUtils'
import { OrthographicCamera, Vector2 } from 'three'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/settings/settingsUtils', () => ({
  jsAppSettings: () => ({}),
}))

describe('animateDraftSegmentListener', () => {
  it('moves the line draft point to the snapped grid position', async () => {
    let onMove: ((args: unknown) => Promise<void>) | undefined
    const sceneInfra = {
      setCallbacks: vi.fn((callbacks) => {
        onMove = callbacks.onMove
      }),
      scene: {
        getObjectByName: vi.fn(() => null),
      },
      getClientSceneScaleFactor: vi.fn(() => 1),
      camControls: {
        camera: new OrthographicCamera(),
      },
      getPixelsPerBaseUnit: vi.fn(() => 100),
    } as unknown as SceneInfra
    const editSegments = vi.fn().mockResolvedValue({
      kclSource: { text: 'updated' },
      sceneGraphDelta: createSceneGraphDelta([]),
    })
    const rustContext = {
      editSegments,
      settingsActor: {},
    } as unknown as RustContext
    const self = {
      send: vi.fn(),
      _parent: {
        send: vi.fn(),
        getSnapshot: () => ({
          context: {
            rustContext: {
              settingsActor: {
                getSnapshot: () => ({
                  context: {
                    modeling: {
                      snapToGrid: { current: true },
                      fixedSizeGrid: { current: true },
                      majorGridSpacing: { current: 2 },
                      minorGridsPerMajor: { current: 4 },
                      snapsPerMinor: { current: 2 },
                    },
                  },
                }),
              },
            },
          },
        }),
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
        kclManager: {
          fileSettings: { defaultLengthUnit: 'Mm' },
        } as unknown as KclManager,
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
