import { decode as msgpackDecode } from '@msgpack/msgpack'
import {
  OcctWasmCommandCoreAdapter,
  createOcctWasmModuleFromEmscripten,
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

  it('adapts the Emscripten C++ command core ABI to WebSocket responses', async () => {
    const module = fakeEmscriptenOcctCore()
    const core = new OcctWasmCommandCoreAdapter(() =>
      createOcctWasmModuleFromEmscripten(module)
    )

    const encoded = await core.sendModelingCommandFromWasm(
      '00000000-0000-0000-0000-000000000015',
      JSON.stringify([0, 0, 0]),
      JSON.stringify({
        type: 'modeling_cmd_req',
        cmd_id: '00000000-0000-0000-0000-000000000016',
        cmd: { type: 'scene_clear_all' },
      }),
      '{}'
    )

    expect(msgpackDecode(encoded)).toMatchObject({
      success: true,
      request_id: '00000000-0000-0000-0000-000000000015',
      resp: {
        type: 'modeling',
        data: { modeling_response: { type: 'empty' } },
      },
    })
    expect(module.freedPointers).toHaveLength(1)
  })
})

function fakeEmscriptenOcctCore() {
  let nextPtr = 1
  const strings = new Map<number, string>()
  const freedPointers: number[] = []

  return {
    freedPointers,
    ccall: (
      name: string,
      _returnType: 'number' | 'string' | null,
      _argTypes: string[],
      args: unknown[]
    ) => {
      if (name === 'zoo_occt_core_free') {
        freedPointers.push(args[0] as number)
        return null
      }
      const ptr = nextPtr++
      strings.set(
        ptr,
        JSON.stringify({
          ok: true,
          engine: 'open_cascade',
          requestId: args[0],
          response: 'modeling',
          commandType: 'scene_clear_all',
          commandIds: ['00000000-0000-0000-0000-000000000016'],
        })
      )
      return ptr
    },
    UTF8ToString: (ptr: number) => strings.get(ptr) ?? '',
  }
}
