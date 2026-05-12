import { encode as msgpackEncode } from '@msgpack/msgpack'
import { describe, expect, it, vi } from 'vitest'
import { OcctWasmTransport } from '@src/network/occtWasmTransport'
import type { OpenCascadeManagerLike } from '@src/network/openCascadeWorkerClient'

describe('OcctWasmTransport', () => {
  it('starts without a WebSocket and forwards modeling commands to its command core', async () => {
    const core = fakeOcctCommandCore()
    const transport = new OcctWasmTransport(core)
    const setStreamIsReady = vi.fn()
    const callbackOnUnitTestingConnection = vi.fn()

    await transport.start({
      width: 256,
      height: 256,
      setStreamIsReady,
      callbackOnUnitTestingConnection,
    })

    expect(transport.connected).toBe(true)
    expect(setStreamIsReady).toHaveBeenCalledWith(true)
    expect(callbackOnUnitTestingConnection).toHaveBeenCalledWith('auth success')

    const response = await transport.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: '00000000-0000-0000-0000-000000000001',
      cmd: { type: 'scene_clear_all' },
    })

    expect(core.sendModelingCommandFromWasm).toHaveBeenCalledWith(
      '00000000-0000-0000-0000-000000000001',
      expect.any(String),
      expect.stringContaining('scene_clear_all'),
      '{}'
    )
    expect(response).toMatchObject({
      success: true,
      request_id: '00000000-0000-0000-0000-000000000001',
    })
  })
})

function fakeOcctCommandCore(): OpenCascadeManagerLike {
  return {
    latestShapeVersion: { value: 0 } as any,
    latestProfileVersion: { value: 0 } as any,
    latestTopologyVersion: { value: 0 } as any,
    latestSketchVersion: { value: 0 } as any,
    latestRegionVersion: { value: 0 } as any,
    latestPlaneVersion: { value: 0 } as any,
    latestVisibilityVersion: { value: 0 } as any,
    latestSelectionFilter: { value: [] } as any,
    latestExportError: { value: undefined } as any,
    startNewSession: vi.fn().mockResolvedValue(undefined),
    recordRollbackMarker: vi.fn().mockResolvedValue(true),
    fireModelingCommandFromWasm: vi.fn(),
    sendModelingCommandFromWasm: vi.fn().mockImplementation((id: string) =>
      Promise.resolve(
        msgpackEncode({
          success: true,
          request_id: id,
          resp: {
            type: 'modeling',
            data: { modeling_response: { type: 'empty' } },
          },
        })
      )
    ),
    getSolidCount: vi.fn().mockReturnValue(0),
    exportLatestGlbBytes: vi.fn().mockResolvedValue(new Uint8Array()),
    exportVisibleGlbBytes: vi.fn().mockResolvedValue([]),
    exportLatestProfileGlbBytes: vi.fn().mockResolvedValue(new Uint8Array()),
    exportLatestTopologyMeshes: vi.fn().mockReturnValue({
      version: 0,
      solids: [],
    }),
    exportLatestSketchLineMeshes: vi.fn().mockReturnValue({
      version: 0,
      segments: [],
    }),
    exportOpenCascadePathPlane: vi.fn().mockReturnValue(undefined),
    isPathVisible: vi.fn().mockReturnValue(false),
    exportLatestPlaneMeshes: vi.fn().mockReturnValue({
      version: 0,
      planes: [],
    }),
    exportLatestGdtAnnotationMeshes: vi.fn().mockReturnValue({
      version: 0,
      annotations: [],
    }),
    isObjectHidden: vi.fn().mockReturnValue(false),
    exportLatestRegionMeshes: vi.fn().mockResolvedValue({
      version: 0,
      regions: [],
    }),
  }
}
