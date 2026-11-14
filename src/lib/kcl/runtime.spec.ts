import type { EngineCommand } from '@src/lang/std/artifactGraph'
import { encode } from '@msgpack/msgpack'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import { createKclRuntime, type KclRuntime } from '@src/lib/kcl/runtime'
import { SceneExecutionEvents } from '@src/lib/kcl/scene/execution'
import { createSettings } from '@src/lib/settings/initialSettings'
import { createTestKclExecutionSettings } from '@src/lib/kcl/scene/executionSettingsTestUtils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

let wasm: ModuleType
const runtimes: KclRuntime[] = []
beforeAll(async () => {
  await moduleFsViaModuleImport({ type: StorageName.NodeFS, options: {} })
  wasm = await loadAndInitialiseWasmInstance(
    'rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm'
  )
})
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
})
function snapshot(code: string, imports: Record<string, string> = {}) {
  return {
    src: '/model/main.kcl',
    files: new Map(
      Object.entries({ '/model/main.kcl': code, ...imports }).map(
        ([path, value]) => [path, new TextEncoder().encode(value)]
      )
    ),
  }
}
async function runtime(
  instance = wasm,
  settings = createSettings(),
  requests: EngineCommand[] = []
) {
  const engine = {
    engineSessionId: undefined,
    startNewSession: vi.fn(async () => {}),
    trackExecution: () => () => {},
    waitForAllModelingCommands: async () => [],
    fireModelingCommandFromWasm: () => undefined,
    sendModelingCommandFromWasm: vi.fn(
      async (id: string, _range: string, command: string) => {
        const request = JSON.parse(command)
        requests.push(request)
        if (request.type === 'modeling_cmd_batch_req')
          return encode({
            success: true,
            request_id: id,
            resp: {
              type: 'modeling_batch',
              data: {
                responses: Object.fromEntries(
                  request.requests.map((item: { cmd_id: string }) => [
                    item.cmd_id,
                    { response: { type: 'empty' } },
                  ])
                ),
              },
            },
          })
        return encode({
          success: true,
          request_id: id,
          resp: {
            type: 'modeling',
            data: { modeling_response: { type: 'empty' } },
          },
        })
      }
    ),
  }
  const nativeSettings = createTestKclExecutionSettings(() => settings)
  const model = await createKclRuntime(
    Promise.resolve(instance),
    engine,
    () => nativeSettings.configuration.peek(),
    () => nativeSettings.rebuildRevision.peek()
  )
  runtimes.push(model)
  return model
}
it('executes current KCL and resolves imports from the captured project bytes', async () => {
  const model = await runtime()
  const result = await model.execute(
    snapshot(
      '@settings(kclVersion = 3.0)\nimport width from "dimensions.kcl"\nanswer = width * 2',
      {
        '/model/dimensions.kcl':
          '@settings(kclVersion = 3.0)\nexport width = 21',
      }
    )
  )
  expect(result.variables.answer).toMatchObject({ type: 'Number', value: 42 })
  expect(model.state.peek()).toBe(result)
  expect(model.failed.peek()).toBe(false)
  const updated = await model.execute(
    snapshot(
      '@settings(kclVersion = 3.0)\nimport width from "dimensions.kcl"\nanswer = width * 2',
      {
        '/model/dimensions.kcl':
          '@settings(kclVersion = 3.0)\nexport width = 22',
      }
    )
  )
  expect(updated.variables.answer).toMatchObject({ value: 44 })
})
it('keeps models independent and recovers after invalid source', async () => {
  const first = await runtime()
  const second = await runtime()
  await first.execute(snapshot('@settings(kclVersion = 3.0)\nanswer = 1'))
  await second.execute(snapshot('@settings(kclVersion = 3.0)\nanswer = 2'))
  expect(first.state.peek().variables.answer).toMatchObject({ value: 1 })
  expect(second.state.peek().variables.answer).toMatchObject({ value: 2 })
  const done = vi.fn()
  first.events.addEventListener(SceneExecutionEvents.ExecutionDone, done)
  await expect(first.execute(snapshot('answer = ('))).rejects.toBeInstanceOf(
    Error
  )
  expect(first.failed.peek()).toBe(true)
  expect(first.executing.peek()).toBe(false)
  expect(done.mock.calls[0][0].detail).toMatchObject({
    successful: false,
    hasErrors: true,
  })
  await first.execute(snapshot('@settings(kclVersion = 3.0)\nanswer = 3'))
  expect(first.state.peek().variables.answer).toMatchObject({ value: 3 })
  expect(first.failed.peek()).toBe(false)
})

it('serializes native exports with execution and waits for borrowed memory before freeing', async () => {
  const execution = Promise.withResolvers<undefined>()
  const exporting = Promise.withResolvers<undefined>()
  const events: string[] = []
  class Context extends wasm.Context {
    async execute(
      ...args: Parameters<InstanceType<ModuleType['Context']>['execute']>
    ) {
      events.push('execute')
      await execution.promise
      return super.execute(...args)
    }
    async export() {
      events.push('export')
      await exporting.promise
      return []
    }
    free() {
      events.push('free')
      super.free()
    }
  }
  const model = await runtime({ ...wasm, Context })
  const run = model.execute(
    snapshot('@settings(kclVersion = 3.0)\nanswer = 42')
  )
  const glb = model.exportModel({
    type: 'gltf',
    storage: 'embedded',
    presentation: 'compact',
  })
  await vi.waitFor(() => expect(events).toEqual(['execute']))
  execution.resolve(undefined)
  expect((await run).variables.answer).toMatchObject({ value: 42 })
  await vi.waitFor(() => expect(events).toEqual(['execute', 'export']))
  const closing = model.dispose()
  expect(events).not.toContain('free')
  exporting.resolve(undefined)
  await glb
  await closing
  expect(events).toEqual(['execute', 'export', 'free'])
  await expect(model.execute(snapshot('answer = 1'))).rejects.toBeInstanceOf(
    Error
  )
})

it('updates streamed edge visibility when settings change with unchanged KCL', async () => {
  const settings = createSettings()
  const requests: EngineCommand[] = []
  const model = await runtime(wasm, settings, requests)
  const source = snapshot('@settings(kclVersion = 3.0)\nanswer = 42')
  settings.modeling.highlightEdges.user = false
  await model.execute(source)
  const commands = () =>
    requests.flatMap((request) =>
      request.type === 'modeling_cmd_batch_req'
        ? request.requests.map((item) => item.cmd)
        : request.type === 'modeling_cmd_req'
          ? [request.cmd]
          : []
    )
  expect(commands()).toContainEqual({
    type: 'edge_lines_visible',
    hidden: true,
  })
  requests.length = 0
  settings.modeling.highlightEdges.user = true
  await model.execute(source)
  expect(commands()).toContainEqual({
    type: 'edge_lines_visible',
    hidden: false,
  })
})

it('rebuilds native streamed scenes only when a declared rebuild input changes', async () => {
  const cleared: string[] = []
  class Context extends wasm.Context {
    async bustCacheAndResetScene(
      ...args: Parameters<
        InstanceType<ModuleType['Context']>['bustCacheAndResetScene']
      >
    ) {
      cleared.push(args[0])
      return super.bustCacheAndResetScene(...args)
    }
  }
  const settings = createSettings()
  const model = await runtime({ ...wasm, Context }, settings)
  const source = snapshot('@settings(kclVersion = 3.0)\nanswer = 42')
  await model.execute(source)
  settings.modeling.highlightEdges.user = false
  await model.execute(source)
  expect(cleared).toEqual([])
  settings.modeling.backfaceColor.user = '#123456'
  await model.execute(source)
  expect(cleared).toHaveLength(1)
  expect(JSON.parse(cleared[0]).settings.modeling.backface_color).toBe(
    '#123456'
  )
  await model.execute(source)
  expect(cleared).toHaveLength(1)
  expect(model.state.peek().variables.answer).toMatchObject({ value: 42 })
})

it('does not start execution after a scene closes during a native rebuild', async () => {
  const clearing = Promise.withResolvers<undefined>()
  const calls: string[] = []
  class Context extends wasm.Context {
    async bustCacheAndResetScene(
      ...args: Parameters<
        InstanceType<ModuleType['Context']>['bustCacheAndResetScene']
      >
    ) {
      calls.push('rebuild')
      await clearing.promise
      return super.bustCacheAndResetScene(...args)
    }
    async execute(
      ...args: Parameters<InstanceType<ModuleType['Context']>['execute']>
    ) {
      calls.push('execute')
      return super.execute(...args)
    }
  }
  const settings = createSettings()
  const model = await runtime({ ...wasm, Context }, settings)
  const source = snapshot('@settings(kclVersion = 3.0)\nanswer = 42')
  await model.execute(source)
  settings.modeling.backfaceColor.user = '#123456'
  const run = model.execute(source)
  await vi.waitFor(() => expect(calls).toEqual(['execute', 'rebuild']))
  const closing = model.dispose()
  clearing.resolve(undefined)
  await expect(run).rejects.toBeInstanceOf(Error)
  await closing
  expect(calls).toEqual(['execute', 'rebuild'])
})
