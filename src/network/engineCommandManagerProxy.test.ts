import { decode as msgpackDecode } from '@msgpack/msgpack'
import { describe, expect, it, vi } from 'vitest'
import { ConnectionManager } from '@src/network/connectionManager'
import { EngineCommandManagerProxy } from '@src/network/engineCommandManagerProxy'
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
})
