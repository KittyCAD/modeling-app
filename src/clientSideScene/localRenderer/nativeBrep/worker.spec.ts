// Vite needs the generated tessellator package even though its exports are mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), tessellate: vi.fn() }))
vi.mock('@rust/display-tessellation/pkg/display_tessellation.js', () => ({
  default: mocks.initialize,
  tessellate_snapshot: mocks.tessellate,
}))
vi.mock(
  '@rust/display-tessellation/pkg/display_tessellation_bg.wasm?url',
  () => ({
    default: 'display.wasm',
  })
)

describe('native B-rep worker', () => {
  let scope: {
    onmessage: ((event: MessageEvent) => void) | null
    postMessage: ReturnType<typeof vi.fn>
  }
  const brep = { surfaces: [], faces: [], loops: [], curves2D: [] }

  beforeEach(async () => {
    vi.resetModules()
    mocks.initialize.mockResolvedValue(undefined)
    mocks.tessellate.mockReset()
    mocks.tessellate.mockImplementation(() => ({
      positions: () => new Float32Array([1, 2, 3]),
      normals: () => new Float32Array([0, 1, 0]),
      faces: () => '[]',
      free: vi.fn(),
    }))
    scope = { onmessage: null, postMessage: vi.fn() }
    vi.stubGlobal('self', scope)
    await import('@src/clientSideScene/localRenderer/nativeBrep/worker')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('accepts an empty current-version scene', async () => {
    scope.onmessage?.({
      data: {
        id: 1,
        snapshot: JSON.stringify({
          version: 1,
          coordinateSystem: 'z-up',
          bodies: [],
        }),
        refinement: 0,
      },
    } as MessageEvent)
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalled())
    expect(scope.postMessage.mock.calls[0][0]).toMatchObject({
      id: 1,
      faceCount: 0,
    })
    expect(scope.postMessage.mock.calls[0][0].positions).toHaveLength(0)
    expect(mocks.tessellate).not.toHaveBeenCalled()
  })

  it('preserves the legacy single-body snapshot frame', async () => {
    scope.onmessage?.({
      data: {
        id: 1,
        snapshot: JSON.stringify({ version: 1, brep }),
        refinement: 0,
      },
    } as MessageEvent)
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalled())
    expect(Array.from(scope.postMessage.mock.calls[0][0].positions)).toEqual([
      1, 2, 3,
    ])
  })

  it.each([
    { version: 2, coordinateSystem: 'z-up', bodies: [] },
    { version: 1, coordinateSystem: 'y-up', bodies: [{ id: 'one', brep }] },
    { version: 1, bodies: [{ id: 'one', brep }] },
  ])('rejects unsupported scene envelopes and recovers', async (scene) => {
    scope.onmessage?.({
      data: { id: 1, snapshot: JSON.stringify(scene), refinement: 0 },
    } as MessageEvent)
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalled())
    expect(scope.postMessage.mock.calls[0][0]).toMatchObject({
      id: 1,
      error: expect.any(String),
    })
    expect(mocks.tessellate).not.toHaveBeenCalled()

    scope.onmessage?.({
      data: {
        id: 2,
        snapshot: JSON.stringify({
          version: 1,
          coordinateSystem: 'z-up',
          bodies: [{ id: 'one', brep }],
        }),
        refinement: 0,
      },
    } as MessageEvent)
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledTimes(2))
    expect(Array.from(scope.postMessage.mock.calls[1][0].positions)).toEqual([
      1, 3, -2,
    ])
    expect(Array.from(scope.postMessage.mock.calls[1][0].normals)).toEqual([
      0, 0, -1,
    ])
  })
})
