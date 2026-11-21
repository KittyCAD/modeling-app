import type { EngineCommand } from '@src/lang/std/artifactGraph'
import { encode } from '@msgpack/msgpack'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { moduleFsViaModuleImport, StorageName } from '@src/lib/fs-zds'
import {
  createKclRuntime,
  type KclRuntime,
} from '@src/lib/kcl/execution/runtime'
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
  requests: EngineCommand[] = [],
  hooks: Partial<
    Pick<
      Parameters<typeof createKclRuntime>[1],
      | 'trackExecution'
      | 'waitForAllModelingCommands'
      | 'fireModelingCommandFromWasm'
    >
  > = {}
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
    ...hooks,
  }
  const nativeSettings = createTestKclExecutionSettings(() => settings)
  const model = await createKclRuntime(Promise.resolve(instance), engine, () =>
    nativeSettings.configuration.peek()
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

it('reapplies streamed backface settings without changing the native scene generation', async () => {
  const settings = createSettings()
  const requests: EngineCommand[] = []
  const model = await runtime(wasm, settings, requests)
  const source = snapshot('@settings(kclVersion = 3.0)\nanswer = 42')
  await model.execute(source)
  const generation = model.state.peek().engineSceneGeneration
  requests.length = 0
  settings.modeling.backfaceColor.user = '#00ff00'
  await model.execute(source)
  const commands = requests.flatMap((request) =>
    request.type === 'modeling_cmd_batch_req'
      ? request.requests.map((item) => item.cmd)
      : request.type === 'modeling_cmd_req'
        ? [request.cmd]
        : []
  )
  expect(commands).toContainEqual(
    expect.objectContaining({
      type: 'set_default_system_properties',
      backface_color: { r: 0, g: 1, b: 0, a: 1 },
    })
  )
  expect(model.state.peek().engineSceneGeneration).toBe(generation)
})

it.each(['execute', 'drain'] as const)(
  'preserves a rejected Error from %s, releases tracking, and accepts the next run',
  async (stage) => {
    const failure = new Error('The engine operation failed')
    let failNext = true
    class Context extends wasm.Context {
      async execute(
        ...args: Parameters<InstanceType<ModuleType['Context']>['execute']>
      ) {
        if (stage === 'execute' && failNext) {
          failNext = false
          throw failure
        }
        return super.execute(...args)
      }
    }
    const stopTracking = vi.fn()
    const model = await runtime({ ...wasm, Context }, createSettings(), [], {
      trackExecution: () => stopTracking,
      waitForAllModelingCommands: async () => {
        if (stage === 'drain' && failNext) {
          failNext = false
          throw failure
        }
        return []
      },
    })
    const done = vi.fn()
    model.events.addEventListener(SceneExecutionEvents.ExecutionDone, done)
    const source = snapshot('@settings(kclVersion = 3.0)\nanswer = 42')
    await expect(model.execute(source)).rejects.toBe(failure)
    expect(model.executing.peek()).toBe(false)
    expect(model.failed.peek()).toBe(true)
    expect(stopTracking).toHaveBeenCalledOnce()
    expect(done.mock.calls[0][0].detail).toMatchObject({
      successful: false,
      hasErrors: true,
    })
    expect((await model.execute(source)).variables.answer).toMatchObject({
      value: 42,
    })
    expect(model.failed.peek()).toBe(false)
    expect(stopTracking).toHaveBeenCalledTimes(2)
    expect(done).toHaveBeenCalledTimes(2)
    expect(done.mock.calls[1][0].detail).toMatchObject({
      successful: true,
      hasErrors: false,
    })
  }
)

it('retains partial native error output while releasing execution tracking', async () => {
  const stopTracking = vi.fn()
  const model = await runtime(wasm, createSettings(), [], {
    trackExecution: () => stopTracking,
  })
  const failure = await model
    .execute(snapshot('@settings(kclVersion = 3.0)\nanswer = missingValue'))
    .catch((cause: unknown) => cause)
  if (
    !(failure instanceof Error) ||
    !('artifactGraph' in failure) ||
    !('defaultPlanes' in failure) ||
    !('engineSceneGeneration' in failure)
  )
    return expect.fail('Expected a native error with partial output')
  expect(model.state.peek()).toMatchObject({
    artifactGraph: failure.artifactGraph,
    defaultPlanes: failure.defaultPlanes,
    engineSceneGeneration: failure.engineSceneGeneration,
  })
  expect(model.executing.peek()).toBe(false)
  expect(model.failed.peek()).toBe(true)
  expect(stopTracking).toHaveBeenCalledOnce()
})

it('waits for native execution and command draining before closing, without publishing late output', async () => {
  const execution = Promise.withResolvers<undefined>()
  const commands = Promise.withResolvers<undefined>()
  const calls: string[] = []
  class Context extends wasm.Context {
    async execute(
      ...args: Parameters<InstanceType<ModuleType['Context']>['execute']>
    ) {
      calls.push('execute')
      await execution.promise
      return super.execute(...args)
    }
    async export() {
      calls.push('export')
      return []
    }
    free() {
      calls.push('free')
      super.free()
    }
  }
  const model = await runtime({ ...wasm, Context }, createSettings(), [], {
    trackExecution: () => () => calls.push('stop'),
    waitForAllModelingCommands: async () => {
      calls.push('drain')
      await commands.promise
      return []
    },
  })
  const baseline = model.state.peek()
  const done = vi.fn()
  model.events.addEventListener(SceneExecutionEvents.ExecutionDone, done)
  const run = model.execute(
    snapshot('@settings(kclVersion = 3.0)\nanswer = 42')
  )
  const queued = model.exportModel({
    type: 'gltf',
    storage: 'embedded',
    presentation: 'compact',
  })
  const rejectedRun = expect(run).rejects.toThrow('The KCL scene closed')
  const rejectedExport = expect(queued).rejects.toThrow('The KCL scene closed')
  try {
    await vi.waitFor(() => expect(calls).toEqual(['execute']))
    const closing = model.dispose()
    execution.resolve(undefined)
    await vi.waitFor(() => expect(calls).toEqual(['execute', 'drain']))
    expect(model.executing.peek()).toBe(true)
    commands.resolve(undefined)
    await Promise.all([rejectedRun, rejectedExport, closing])
    expect(calls).toEqual(['execute', 'drain', 'stop', 'free'])
    expect(model.state.peek()).toBe(baseline)
    expect(model.executing.peek()).toBe(false)
    expect(done).not.toHaveBeenCalled()
  } finally {
    execution.resolve(undefined)
    commands.resolve(undefined)
  }
})

it.each(['stl', 'ply', 'step', 'obj'])(
  'completes a native %s import when its asynchronous engine reply arrives',
  async (extension) => {
    const imported = Promise.withResolvers<{
      id: string
      request: EngineCommand
    }>()
    const model = await runtime(wasm, createSettings(), [], {
      fireModelingCommandFromWasm: (id, _range, command) => {
        imported.resolve({ id, request: JSON.parse(command) })
        return undefined
      },
    })
    const run = model.execute(
      snapshot(
        `@settings(kclVersion = 3.0)\nimport "body.${extension}" as previewModel`,
        { [`/model/body.${extension}`]: 'model bytes' }
      )
    )
    const { id, request } = await imported.promise
    expect(request).toMatchObject({
      type: 'modeling_cmd_req',
      cmd: { type: 'import_files', files: [{ path: `body.${extension}` }] },
    })
    expect(model.executing.peek()).toBe(true)
    // This must reach WASM while execute is waiting, rather than queueing behind it.
    await model.sendResponse({
      success: true,
      request_id: id,
      resp: {
        type: 'modeling',
        data: {
          modeling_response: { type: 'import_files', data: { object_id: id } },
        },
      },
    })
    const result = await run
    expect([...result.artifactGraph.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'importedGeometry' }),
      ])
    )
    expect(model.executing.peek()).toBe(false)
    expect(model.failed.peek()).toBe(false)
  }
)

it('finishes pending response delivery before freeing native memory and ignores later replies', async () => {
  const delivery = Promise.withResolvers<undefined>()
  const calls: string[] = []
  class Context extends wasm.Context {
    async sendResponse() {
      calls.push('response')
      await delivery.promise
    }
    free() {
      calls.push('free')
      super.free()
    }
  }
  const model = await runtime({ ...wasm, Context })
  const response = {
    success: true,
    request_id: 'response-id',
    resp: { type: 'modeling', data: { modeling_response: { type: 'empty' } } },
  } as const
  const sending = model.sendResponse(response)
  const closing = model.dispose()
  try {
    await Promise.resolve()
    expect(calls).toEqual(['response'])
  } finally {
    delivery.resolve(undefined)
  }
  await Promise.all([sending, closing])
  await model.sendResponse(response)
  expect(calls).toEqual(['response', 'free'])
})
