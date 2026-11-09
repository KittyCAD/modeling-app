import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { expect, it, beforeAll } from 'vitest'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { assertParse } from '@src/lang/wasm'
import { createViewerKclRuntime } from '@src/lib/kcl/runtime'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
let wasm: ModuleType
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  wasm = await loadAndInitialiseWasmInstance(
    `${process.cwd()}/public/kcl_wasm_lib_bg.wasm`
  )
})
/** Numeric-only programs need lifecycle acknowledgements, not simulated geometry results. */
async function modelRuntime(commands: string[] = []) {
  return createViewerKclRuntime(
    Promise.resolve(wasm),
    async (message) => {
      const request = JSON.parse(message)
      commands.push(request.cmd?.type ?? request.type)
      if (request.type === 'modeling_cmd_batch_req')
        return {
          success: true,
          request_id: request.batch_id,
          resp: {
            type: 'modeling_batch',
            data: {
              responses: Object.fromEntries(
                request.requests.map(({ cmd_id }: { cmd_id: string }) => [
                  cmd_id,
                  { success: true, response: { type: 'empty' } },
                ])
              ),
            },
          },
        }
      return {
        success: true,
        request_id: request.cmd_id,
        resp: {
          type: 'modeling',
          data: { modeling_response: { type: 'empty' } },
        },
      }
    },
    () => ({ settings: { modeling: { base_unit: 'mm' } } })
  )
}

it('evaluates model variables after execution and preserves them across mock review', async () => {
  const commands: string[] = []
  const runtime = await modelRuntime(commands)
  try {
    await runtime.execute(
      '@settings(kclVersion = 3.0)\nheight = 24mm',
      '/project/main.kcl'
    )
    const sentBeforeReview = commands.length
    const result = await stringToKclExpression('height / 2', runtime)
    expect(result).toMatchObject({ valueCalculated: '12mm' })
    const error = await runtime.validate(
      assertParse('bad = unknownVariable', wasm),
      '/project/main.kcl'
    )
    expect(error?.message).toContain('unknownVariable')
    expect(await stringToKclExpression('height / 2', runtime)).toMatchObject({
      valueCalculated: '12mm',
    })
    expect(
      await runtime.validate(
        assertParse('@settings(kclVersion = 3.0)\nheight = 100mm', wasm),
        '/project/main.kcl'
      )
    ).toBeUndefined()
    expect(await stringToKclExpression('height / 2', runtime)).toMatchObject({
      valueCalculated: '12mm',
    })
    expect(commands).toHaveLength(sentBeforeReview)
  } finally {
    await runtime.dispose()
  }
})

it('isolates model memory and reads the captured imported files during expression evaluation and review', async () => {
  const first = await modelRuntime()
  const second = await modelRuntime()
  const src = '/project/main.kcl'
  const code =
    '@settings(kclVersion = 3.0)\nimport height from "dimensions.kcl"\nwidth = height / 2'
  try {
    await first.execute(
      new Map([
        [src, code],
        ['/project/dimensions.kcl', 'export height = 24mm'],
      ]),
      src
    )
    await second.execute(
      '@settings(kclVersion = 3.0)\nheight = 80mm',
      '/other/main.kcl'
    )
    expect(await stringToKclExpression('height', first)).toMatchObject({
      valueCalculated: '24mm',
    })
    expect(await stringToKclExpression('height', second)).toMatchObject({
      valueCalculated: '80mm',
    })
    expect(
      await first.validate(
        assertParse(code + '\ncheck = width + 1mm', wasm),
        src
      )
    ).toBeUndefined()
    await first.execute(
      new Map([
        [src, code],
        ['/project/dimensions.kcl', 'export height = 40mm'],
      ]),
      src
    )
    expect(await stringToKclExpression('width', first)).toMatchObject({
      valueCalculated: '20mm',
    })
    expect(
      await first.validate(
        assertParse(code + '\nassert(width, isEqualTo = 20mm)', wasm),
        src
      )
    ).toBeUndefined()
  } finally {
    await Promise.all([first.dispose(), second.dispose()])
  }
})
