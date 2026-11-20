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

  it('identifies a full GLB returned by an Engine that ignored the preview option', async () => {
    const json = new TextEncoder().encode(JSON.stringify({ meshes: [{}] }))
    const snapshot = new Uint8Array(20 + json.length)
    const header = new DataView(snapshot.buffer)
    header.setUint32(0, 0x46546c67, true)
    header.setUint32(12, json.length, true)
    header.setUint32(16, 0x4e4f534a, true)
    snapshot.set(json, 20)
    scope.onmessage?.({
      data: { id: 1, snapshot, refinement: 0 },
    } as MessageEvent)
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledOnce())
    expect(scope.postMessage.mock.calls[0][0]).toMatchObject({
      id: 1,
      unsupportedExport: true,
    })
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

  it('retries only the body that exceeds its tessellation budget', async () => {
    const firstFree = vi.fn()
    const secondFree = vi.fn()
    const makeMesh = (x: number, release: ReturnType<typeof vi.fn>) => ({
      positions: () => new Float32Array([x, 2, 3]),
      normals: () => new Float32Array([0, 1, 0]),
      faces: () => '[{}]',
      free: release,
    })
    mocks.tessellate
      .mockReturnValueOnce(makeMesh(1, firstFree))
      .mockImplementationOnce(() => {
        throw new Error('Display triangle budget exceeded')
      })
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
      packed[1],
    ])
    expect(calls[2][2]).toBe(0)
    for (const release of [firstFree, secondFree]) {
      expect(release).toHaveBeenCalledTimes(1)
    }
  })

  it('reuses unchanged geometry, remeshes changes under the same body ID, and keeps cached buffers untransformed', async () => {
    const send = async (id: number, changed: boolean, refinement = 0) => {
      scope.onmessage?.({
        data: {
          id,
          refinement,
          snapshot: JSON.stringify({
            version: 1,
            coordinateSystem: 'z-up',
            bodies: [
              { id: 'one', brep },
              { id: 'two', brep: { ...brep, loops: changed ? [{}] : [] } },
            ],
          }),
        },
      } as MessageEvent)
      await vi.waitFor(() =>
        expect(scope.postMessage).toHaveBeenCalledTimes(id)
      )
    }
    await send(1, false)
    expect(mocks.tessellate).toHaveBeenCalledTimes(1)
    await send(2, true)
    expect(mocks.tessellate).toHaveBeenCalledTimes(2)
    for (const [response, options] of scope.postMessage.mock.calls) {
      expect(Array.from(response.positions)).toEqual([1, 3, -2, 1, 3, -2])
      expect(Array.from(response.normals)).toEqual([0, 0, -1, 0, 0, -1])
      expect(options.transfer).toEqual([
        response.positions.buffer,
        response.normals.buffer,
      ])
    }
    await send(3, true, 1)
    expect(mocks.tessellate).toHaveBeenCalledTimes(4)
    expect(free).toHaveBeenCalledTimes(4)
    scope.onmessage?.({
      data: {
        id: 4,
        snapshot: JSON.stringify({
          version: 1,
          coordinateSystem: 'z-up',
          bodies: [],
        }),
        refinement: 1,
      },
    } as MessageEvent)
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledTimes(4))
    await send(5, true, 1)
    expect(mocks.tessellate).toHaveBeenCalledTimes(6)
  })

  it('coarsens the largest body to fit the scene without remeshing the others', async () => {
    const makeMesh = (triangles: number) => ({
      positions: () => new Float32Array(triangles * 9),
      normals: () => new Float32Array(triangles * 9),
      faces: () => '[{}]',
      free,
    })
    mocks.tessellate
      .mockReturnValueOnce(makeMesh(120_000))
      .mockReturnValueOnce(makeMesh(90_000))
      .mockReturnValueOnce(makeMesh(60_000))
    scope.onmessage?.({
      data: {
        id: 1,
        refinement: 0,
        snapshot: JSON.stringify({
          version: 1,
          coordinateSystem: 'z-up',
          bodies: [
            { id: 'one', brep },
            { id: 'two', brep: { ...brep, loops: [{}] } },
          ],
        }),
      },
    } as MessageEvent)
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledOnce())
    expect(scope.postMessage.mock.calls[0][0].positions).toHaveLength(
      150_000 * 9
    )
    expect(scope.postMessage.mock.calls[0][0].faceCount).toBe(2)
    expect(mocks.tessellate).toHaveBeenCalledTimes(3)
    expect(mocks.tessellate.mock.calls[2][0]).toBe(
      mocks.tessellate.mock.calls[0][0]
    )
    expect(mocks.tessellate.mock.calls[2][2]).toBe(0)
    expect(free).toHaveBeenCalledTimes(3)
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
