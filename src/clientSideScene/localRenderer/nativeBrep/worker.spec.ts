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
  let free: ReturnType<typeof vi.fn>
  const brep = { surfaces: [], faces: [], loops: [], curves2D: [] }

  beforeEach(async () => {
    vi.resetModules()
    mocks.initialize.mockResolvedValue(undefined)
    mocks.tessellate.mockReset()
    free = vi.fn()
    mocks.tessellate.mockImplementation(() => ({
      positions: () => new Float32Array([1, 2, 3]),
      normals: () => new Float32Array([0, 1, 0]),
      faces: () => '[]',
      free,
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
    expect(free).toHaveBeenCalledTimes(1)
  })

  it('frees an allocated mesh when reading it fails and handles the next request', async () => {
    const failedFree = vi.fn()
    mocks.tessellate.mockReturnValueOnce({
      positions: () => {
        throw new Error('Cannot read positions')
      },
      free: failedFree,
    })
    const snapshot = JSON.stringify({ version: 1, brep })
    scope.onmessage?.({
      data: { id: 1, snapshot, refinement: 0 },
    } as MessageEvent)
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledOnce())
    expect(scope.postMessage.mock.calls[0][0]).toEqual({
      id: 1,
      error: 'Cannot read positions',
    })
    expect(failedFree).toHaveBeenCalledTimes(1)

    scope.onmessage?.({
      data: { id: 2, snapshot, refinement: 0 },
    } as MessageEvent)
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledTimes(2))
    expect(scope.postMessage.mock.calls[1][0]).toMatchObject({ id: 2 })
    expect(Array.from(scope.postMessage.mock.calls[1][0].positions)).toEqual([
      1, 2, 3,
    ])
    expect(free).toHaveBeenCalledTimes(1)
    expect(failedFree).toHaveBeenCalledTimes(1)
  })

  it('retries every body at coarse quality without retaining the partial first attempt', async () => {
    const partialFree = vi.fn()
    const firstFree = vi.fn()
    const secondFree = vi.fn()
    const makeMesh = (x: number, release: ReturnType<typeof vi.fn>) => ({
      positions: () => new Float32Array([x, 2, 3]),
      normals: () => new Float32Array([0, 1, 0]),
      faces: () => '[{}]',
      free: release,
    })
    mocks.tessellate
      .mockReturnValueOnce(makeMesh(99, partialFree))
      .mockImplementationOnce(() => {
        throw new Error('Display triangle budget exceeded')
      })
      .mockReturnValueOnce(makeMesh(1, firstFree))
      .mockReturnValueOnce(makeMesh(4, secondFree))
    const bodies = [
      { id: 'one', brep },
      {
        id: 'two',
        brep: { ...brep, surfaces: [{ type: 'plane', plane: {} }] },
      },
    ]
    scope.onmessage?.({
      data: {
        id: 1,
        snapshot: JSON.stringify({
          version: 1,
          coordinateSystem: 'z-up',
          bodies,
        }),
        refinement: 0,
      },
    } as MessageEvent)
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledOnce())
    const response = scope.postMessage.mock.calls[0][0]
    expect(response).toMatchObject({ id: 1, faceCount: 2 })
    expect(Array.from(response.positions)).toEqual([1, 3, -2, 4, 3, -2])
    expect(Array.from(response.normals)).toEqual([0, 0, -1, 0, 0, -1])
    const packed = bodies.map((body) => ({ version: 1, brep: body.brep }))
    const calls = mocks.tessellate.mock.calls
    expect(calls.map(([snapshot]) => JSON.parse(snapshot))).toEqual([
      ...packed,
      ...packed,
    ])
    for (let i = 0; i < bodies.length; i++) {
      expect(calls[i + bodies.length][2]).toBeLessThan(calls[i][2])
    }
    for (const release of [partialFree, firstFree, secondFree]) {
      expect(release).toHaveBeenCalledTimes(1)
    }
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
