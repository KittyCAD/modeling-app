import { decode as msgpackDecode } from '@msgpack/msgpack'
import { describe, expect, it, vi } from 'vitest'
import { assertParse } from '@src/lang/wasm'
import { ConnectionManager } from '@src/network/connectionManager'
import { EngineCommandManagerProxy } from '@src/network/engineCommandManagerProxy'
import { OPEN_CASCADE_CIRCLE_EXTRUDE_KCL } from '@src/network/openCascadeProofFixture'
import { buildTheWorldAndNoEngineConnection } from '@src/unitTestUtils'

const RANGE = JSON.stringify([0, 0, 0])
const ID_MAP = '{}'

describe('EngineCommandManagerProxy', () => {
  it('delegates WASM modeling commands to Zoo by default', async () => {
    const { engineCommandManager } =
      await buildTheWorldAndNoEngineConnection(true)
    const proxy = engineCommandManager as EngineCommandManagerProxy
    const encoded = new Uint8Array([1, 2, 3])
    const spy = vi
      .spyOn(ConnectionManager.prototype, 'sendModelingCommandFromWasm')
      .mockResolvedValue(encoded)

    await expect(
      proxy.sendModelingCommandFromWasm(
        '00000000-0000-0000-0000-000000000001',
        RANGE,
        JSON.stringify({
          type: 'modeling_cmd_req',
          cmd_id: '00000000-0000-0000-0000-000000000002',
          cmd: { type: 'scene_clear_all' },
        }),
        ID_MAP
      )
    ).resolves.toBe(encoded)
    expect(spy).toHaveBeenCalledOnce()

    spy.mockRestore()
  })

  it('switches to OpenCascade without replacing the proxy object', async () => {
    const { engineCommandManager, settingsActor } =
      await buildTheWorldAndNoEngineConnection(true)
    const proxy = engineCommandManager as EngineCommandManagerProxy
    const originalProxy = proxy

    expect(proxy.currentEngine).toBe('zoo')

    await vi.waitFor(() =>
      expect(settingsActor.getSnapshot().value).toBe('idle')
    )

    settingsActor.send({
      type: 'set.modeling.engine',
      data: { level: 'user', value: 'open_cascade' },
      doNotPersist: true,
    })

    expect(proxy).toBe(originalProxy)
    expect(proxy.currentEngine).toBe('open_cascade')

    const encoded = await proxy.sendModelingCommandFromWasm(
      '00000000-0000-0000-0000-000000000003',
      RANGE,
      JSON.stringify({
        type: 'modeling_cmd_req',
        cmd_id: '00000000-0000-0000-0000-000000000004',
        cmd: { type: 'scene_clear_all' },
      }),
      ID_MAP
    )
    const response = msgpackDecode(encoded!)

    expect(response).toMatchObject({
      success: true,
      request_id: '00000000-0000-0000-0000-000000000003',
    })
  })

  it('forwards OpenCascade scene command batches for selection filters', async () => {
    const { engineCommandManager, settingsActor } =
      await buildTheWorldAndNoEngineConnection(true)
    const proxy = engineCommandManager as EngineCommandManagerProxy

    await vi.waitFor(() =>
      expect(settingsActor.getSnapshot().value).toBe('idle')
    )
    settingsActor.send({
      type: 'set.modeling.engine',
      data: { level: 'user', value: 'open_cascade' },
      doNotPersist: true,
    })

    await proxy.sendSceneCommand({
      type: 'modeling_cmd_batch_req',
      batch_id: '00000000-0000-0000-0000-000000000005',
      requests: [
        {
          cmd_id: '00000000-0000-0000-0000-000000000006',
          cmd: {
            type: 'set_selection_filter',
            filter: ['object'],
          },
        },
      ],
      responses: false,
    })

    expect(proxy.openCascadeCommandManager.latestSelectionFilter.value).toEqual(
      ['object']
    )
  })

  it('runs OpenCascade previews against an isolated manager', async () => {
    const { engineCommandManager, instance, rustContext, settingsActor } =
      await buildTheWorldAndNoEngineConnection()
    const proxy = engineCommandManager as EngineCommandManagerProxy

    await vi.waitFor(() =>
      expect(settingsActor.getSnapshot().value).toBe('idle')
    )
    settingsActor.send({
      type: 'set.modeling.engine',
      data: { level: 'user', value: 'open_cascade' },
      doNotPersist: true,
    })

    const ast = assertParse(OPEN_CASCADE_CIRCLE_EXTRUDE_KCL, instance)
    await proxy.runOpenCascadePreviewAst(ast, rustContext, {
      settings: { modeling: { engine: 'open_cascade' } },
    })

    expect(proxy.openCascadeCommandManager.getSolidCount()).toBe(0)
    const previewGlbs = await proxy.exportVisibleOpenCascadePreviewGlbBytes()
    expect(previewGlbs).toHaveLength(1)
    expect(previewGlbs[0]?.bytes.length).toBeGreaterThan(0)
    expect(proxy.latestOpenCascadePreviewStatus.value).toBe('ready')

    proxy.clearOpenCascadePreview()
    expect(await proxy.exportVisibleOpenCascadePreviewGlbBytes()).toEqual([])
    expect(proxy.latestOpenCascadePreviewStatus.value).toBe('idle')
  })
})
