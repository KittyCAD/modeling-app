import { decode as msgpackDecode } from '@msgpack/msgpack'
import {
  OcctWasmCommandCoreAdapter,
  createProtocolOnlyOcctWasmModule,
} from '@src/network/occtWasmCommandCore'
import { describe, expect, it } from 'vitest'

describe('OcctWasmCommandCoreAdapter', () => {
  it('adapts a protocol-shaped OCCT WASM module to the browser command core contract', async () => {
    const core = new OcctWasmCommandCoreAdapter(
      createProtocolOnlyOcctWasmModule
    )

    await core.startNewSession()
    const encoded = await core.sendModelingCommandFromWasm(
      '00000000-0000-0000-0000-000000000010',
      JSON.stringify([0, 0, 0]),
      JSON.stringify({
        type: 'modeling_cmd_req',
        cmd_id: '00000000-0000-0000-0000-000000000011',
        cmd: { type: 'scene_clear_all' },
      }),
      '{}'
    )

    expect(msgpackDecode(encoded)).toMatchObject({
      success: true,
      request_id: '00000000-0000-0000-0000-000000000010',
    })
    await expect(core.waitForAllModelingCommands()).resolves.toHaveLength(0)
  })

  it('keeps lightweight browser-side side effects for protocol-only commands', async () => {
    const core = new OcctWasmCommandCoreAdapter(
      createProtocolOnlyOcctWasmModule
    )

    await core.sendModelingCommandFromWasm(
      '00000000-0000-0000-0000-000000000012',
      JSON.stringify([0, 0, 0]),
      JSON.stringify({
        type: 'modeling_cmd_batch_req',
        batch_id: '00000000-0000-0000-0000-000000000013',
        requests: [
          {
            cmd_id: '00000000-0000-0000-0000-000000000014',
            cmd: {
              type: 'set_selection_filter',
              filter: ['object'],
            },
          },
        ],
        responses: false,
      }),
      '{}'
    )

    expect(core.latestSelectionFilter.value).toEqual(['object'])
  })
})
