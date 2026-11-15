import { afterEach, beforeAll, expect, it } from 'vitest'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { assertParse } from '@src/lang/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { createSketchRuntime } from '@src/lib/kcl/sketchRuntime'
import {
  createDraftCircle,
  commitCircle,
} from '@src/machines/sketchSolve/tools/circleOperations'
import { createSettings } from '@src/lib/settings/initialSettings'
import { createSceneExecutionSettings } from '@src/lib/scene/settings'
import { encode } from '@msgpack/msgpack'
let wasm: ModuleType
const cleanup: (() => void)[] = []
beforeAll(async () => {
  wasm = await loadAndInitialiseWasmInstance(
    'rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm'
  )
})
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose()
})
it('creates a sketch and commits a circle through the shared native circle operations', async () => {
  const config = createSceneExecutionSettings(() =>
    createSettings()
  ).configuration.peek()
  const native = new wasm.Context(
    {
      sendModelingCommandFromWasm: async (
        id: string,
        _range: string,
        command: string
      ) => {
        const request = JSON.parse(command)
        return encode({
          success: true,
          request_id: id,
          resp:
            request.type === 'modeling_cmd_batch_req'
              ? {
                  type: 'modeling_batch',
                  data: {
                    responses: Object.fromEntries(
                      request.requests.map((item: { cmd_id: string }) => [
                        item.cmd_id,
                        { response: { type: 'empty' } },
                      ])
                    ),
                  },
                }
              : {
                  type: 'modeling',
                  data: { modeling_response: { type: 'empty' } },
                },
        })
      },
      fireModelingCommandFromWasm: () => {},
      startNewSession: async () => {},
    },
    {
      readFile: async () => new Uint8Array(),
      exists: async () => true,
      getAllFiles: async () => JSON.stringify(['/main.kcl']),
    }
  )
  cleanup.push(() => native.free())
  const code = '@settings(kclVersion = 3.0)\nanswer = 42'
  const ast = assertParse(code, wasm)
  await native.executeMock(
    JSON.stringify(ast),
    '/main.kcl',
    JSON.stringify(config),
    false
  )
  let accepted = ''
  const sketch = createSketchRuntime(
    native,
    (work) => work(),
    () => config,
    (text) => {
      accepted = text
    },
    () => {}
  )
  await sketch.synchronize(ast)
  const created = await sketch.create({ on: { default: 'xy' } })
  const initialSource = created.sourceDelta.text
  expect(sketch.sourceFor(created.sceneGraphDelta)).toBe(initialSource)
  expect(
    sketch.sourceFor({ ...created.sceneGraphDelta, new_objects: [] })
  ).toBe(initialSource)
  const input = {
    rustContext: sketch.mutations,
    sketchId: created.sketchId,
    lengthUnit: 'mm' as const,
    centerPoint: [0, 0] as [number, number],
  }
  const draft = await createDraftCircle({ input })
  if ('error' in draft) throw new Error(draft.error)
  expect(accepted).toBe('')
  const committed = await commitCircle({
    input: { ...input, circleId: draft.draft.circleId, startPoint: [10, 0] },
  })
  if ('error' in committed) throw new Error(committed.error)
  expect(sketch.sourceFor(created.sceneGraphDelta)).toBe(initialSource)
  expect(sketch.sourceFor(committed.sceneGraphDelta)).toBe(
    committed.kclSource.text
  )
  sketch.accept(committed.kclSource.text, committed.sceneGraphDelta)
  expect(accepted).toContain('sketch(on = XY)')
  expect(accepted).toContain('circle(')
  expect(accepted).toContain('answer = 42')
  await sketch.close(created.sketchId)
  expect(sketch.sourceFor(committed.sceneGraphDelta)).toBeUndefined()
})
