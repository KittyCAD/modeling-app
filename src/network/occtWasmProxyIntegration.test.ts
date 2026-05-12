import { decode as msgpackDecode } from '@msgpack/msgpack'
import { createSettings } from '@src/lib/settings/initialSettings'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import { EngineCommandManagerProxy } from '@src/network/engineCommandManagerProxy'
import {
  OcctWasmCommandCoreAdapter,
  createProtocolOnlyOcctWasmModule,
} from '@src/network/occtWasmCommandCore'
import { OcctWasmTransport } from '@src/network/occtWasmTransport'
import { describe, expect, it, vi } from 'vitest'

const RANGE = JSON.stringify([0, 0, 0])
const ID_MAP = '{}'

describe('EngineCommandManagerProxy with custom OCCT WASM core', () => {
  it('runs OpenCascade commands through the custom core without a WebSocket', async () => {
    const proxy = new EngineCommandManagerProxy(
      { settingsActor: openCascadeSettingsActor() },
      {
        createOpenCascadeTransport: () =>
          new OcctWasmTransport(
            new OcctWasmCommandCoreAdapter(createProtocolOnlyOcctWasmModule)
          ),
      }
    )
    const setStreamIsReady = vi.fn()

    await proxy.start({
      width: 256,
      height: 256,
      token: '',
      setStreamIsReady,
    })

    const encoded = await proxy.sendModelingCommandFromWasm(
      '00000000-0000-0000-0000-000000000015',
      RANGE,
      JSON.stringify({
        type: 'modeling_cmd_req',
        cmd_id: '00000000-0000-0000-0000-000000000016',
        cmd: { type: 'scene_clear_all' },
      }),
      ID_MAP
    )

    expect(proxy.connection).toBeUndefined()
    expect(setStreamIsReady).toHaveBeenCalledWith(true)
    expect(encoded).toBeDefined()
    expect(msgpackDecode(encoded as Uint8Array)).toMatchObject({
      success: true,
      request_id: '00000000-0000-0000-0000-000000000015',
    })
  })
})

function openCascadeSettingsActor(): SettingsActorType {
  const settings = createSettings()
  settings.modeling.engine.current = 'open_cascade'
  return {
    getSnapshot: () => ({
      context: settings,
    }),
  } as SettingsActorType
}
