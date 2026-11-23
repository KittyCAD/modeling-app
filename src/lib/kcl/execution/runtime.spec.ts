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
      'trackExecution' | 'waitForAllModelingCommands'
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

it('publishes file units and execution timing independently for each scene', async () => {
  const first = await runtime(),
    second = await runtime()
  await first.execute(
    snapshot('@settings(kclVersion = 3.0, defaultLengthUnit = in)\nanswer = 42')
  )
  await second.execute(
    snapshot('@settings(kclVersion = 3.0, defaultLengthUnit = mm)\nanswer = 5')
  )
  expect(first.fileSettings.peek().defaultLengthUnit).toBe('in')
  expect(second.fileSettings.peek().defaultLengthUnit).toBe('mm')
  expect(first.ast.peek()).not.toBeNull()
  expect(first.executionElapsedMs.peek()).toBeGreaterThanOrEqual(0)
  expect(first.executing.peek()).toBe(false)
  await first.execute(snapshot('@settings(kclVersion = 3.0)\nanswer = 43'))
  expect(first.fileSettings.peek().defaultLengthUnit).toBe('mm')
  expect(first.executionRevision.peek()).toBe(2)
  expect(second.executionRevision.peek()).toBe(1)
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

it('captures native settings before waiting behind an earlier execution', async () => {
  const settings = createSettings()
  settings.modeling.defaultUnit.user = 'mm'
  const pending = Promise.withResolvers<undefined>()
  const configurations: object[] = []
  class Context extends wasm.Context {
    async execute(
      ...args: Parameters<InstanceType<ModuleType['Context']>['execute']>
    ) {
      configurations.push(JSON.parse(args[2]))
      if (configurations.length === 1) await pending.promise
      return super.execute(...args)
    }
  }
  const model = await runtime({ ...wasm, Context }, settings)
  const source = snapshot('@settings(kclVersion = 3.0)\nanswer = 42')
  const first = model.execute(source)
  await vi.waitFor(() => expect(configurations).toHaveLength(1))
  settings.modeling.defaultUnit.user = 'in'
  const queued = model.execute(source)
  settings.modeling.defaultUnit.user = 'mm'
  pending.resolve(undefined)
  await Promise.all([first, queued])
  expect(configurations).toMatchObject([
    { settings: { modeling: { base_unit: 'mm' } } },
    { settings: { modeling: { base_unit: 'in' } } },
  ])
})

it('waits for borrowed legacy work before freeing the native context and rejects later borrows', async () => {
  const freed = vi.fn()
  class NativeContext extends wasm.Context {
    free() {
      freed()
      super.free()
    }
  }
  const model = await runtime({ ...wasm, Context: NativeContext })
  const started = Promise.withResolvers<undefined>(),
    release = Promise.withResolvers<undefined>()
  const work = model.nativeContextHost.run(async () => {
    started.resolve(undefined)
    await release.promise
  })
  await started.promise
  const closing = model.dispose()
  expect(freed).not.toHaveBeenCalled()
  release.resolve(undefined)
  await work
  await closing
  expect(freed).toHaveBeenCalledOnce()
  await expect(model.nativeContextHost.create()).rejects.toThrow('closed')
  await expect(model.nativeContextHost.run(async () => {})).rejects.toThrow(
    'closed'
  )
})

it('delivers replies during queued work and waits for pending replies before freeing native memory', async () => {
  const freed = vi.fn()
  class NativeContext extends wasm.Context {
    free() {
      freed()
      super.free()
    }
  }
  const model = await runtime({ ...wasm, Context: NativeContext })
  const operationStarted = Promise.withResolvers<undefined>()
  const releaseOperation = Promise.withResolvers<undefined>()
  const releaseResponse = Promise.withResolvers<undefined>()
  const responseStarted = Promise.withResolvers<undefined>()
  const work = model.nativeContextHost.run(async () => {
    operationStarted.resolve(undefined)
    await releaseOperation.promise
  })
  try {
    await operationStarted.promise
    const closing = model.dispose()
    const response = model.nativeContextHost.deliverResponse(async () => {
      responseStarted.resolve(undefined)
      await releaseResponse.promise
    })
    await responseStarted.promise
    expect(freed).not.toHaveBeenCalled()
    releaseOperation.resolve(undefined)
    await work
    expect(freed).not.toHaveBeenCalled()
    releaseResponse.resolve(undefined)
    await Promise.all([response, closing])
    expect(freed).toHaveBeenCalledOnce()
    await expect(
      model.nativeContextHost.deliverResponse(async () => {})
    ).rejects.toThrow('closed')
  } finally {
    releaseOperation.resolve(undefined)
    releaseResponse.resolve(undefined)
  }
})

it('skips acknowledged machine edits but waits for their owner before executing changed imports', async () => {
  const execute = vi.fn()
  class NativeContext extends wasm.Context {
    async execute(
      ...args: Parameters<InstanceType<ModuleType['Context']>['execute']>
    ) {
      execute()
      return super.execute(...args)
    }
  }
  const model = await runtime({ ...wasm, Context: NativeContext })
  const code =
    '@settings(kclVersion = 3.0)\nimport width from "dimensions.kcl"\nanswer = width * 3'
  await model.execute(
    snapshot(code, {
      '/model/dimensions.kcl': '@settings(kclVersion = 3.0)\nexport width = 7',
    })
  )
  const release = Promise.withResolvers<undefined>()
  let releaseLease = () => {}
  const invalidated = vi.fn(async () => {
    await release.promise
    releaseLease()
  })
  const lease = model.borrowModel(invalidated)
  if (lease instanceof Error) throw lease
  releaseLease = lease.release
  try {
    const edited = code.replace('width * 3', 'width * 4')
    lease.source(edited)
    await model.execute(
      snapshot(edited, {
        '/model/dimensions.kcl':
          '@settings(kclVersion = 3.0)\nexport width = 7',
      })
    )
    expect(execute).toHaveBeenCalledOnce()
    const rerun = model.execute(
      snapshot(edited, {
        '/model/dimensions.kcl':
          '@settings(kclVersion = 3.0)\nexport width = 21',
      })
    )
    await vi.waitFor(() => expect(invalidated).toHaveBeenCalledOnce())
    expect(execute).toHaveBeenCalledOnce()
    release.resolve(undefined)
    expect((await rerun).variables.answer).toMatchObject({
      type: 'Number',
      value: 84,
    })
    lease.source('stale source')
    expect(
      new TextDecoder().decode(
        model.sources.peek()?.files.get('/model/main.kcl')
      )
    ).toBe(edited)
  } finally {
    release.resolve(undefined)
    lease.release()
  }
})

it('uses a retained configuration when deciding whether an editing owner can reuse its native model', async () => {
  const settings = createSettings()
  settings.modeling.defaultUnit.user = 'mm'
  const configurations: object[] = []
  class Context extends wasm.Context {
    async execute(
      ...args: Parameters<InstanceType<ModuleType['Context']>['execute']>
    ) {
      configurations.push(JSON.parse(args[2]))
      return super.execute(...args)
    }
  }
  const model = await runtime({ ...wasm, Context }, settings)
  const source = snapshot('@settings(kclVersion = 3.0)\nanswer = 42')
  const millimeters = createTestKclExecutionSettings(
    () => settings
  ).configuration.peek()
  await model.execute(source, millimeters)
  settings.modeling.defaultUnit.user = 'in'
  let release = () => {}
  const invalidated = vi.fn(async () => release())
  const lease = model.borrowModel(invalidated)
  if (lease instanceof Error) throw lease
  release = lease.release
  // A refresh can retain the previous configuration while newer preferences exist.
  await model.execute(source, millimeters)
  expect(invalidated).not.toHaveBeenCalled()
  expect(configurations).toHaveLength(1)
  const inches = createTestKclExecutionSettings(
    () => settings
  ).configuration.peek()
  await model.execute(source, inches)
  expect(invalidated).toHaveBeenCalledOnce()
  expect(configurations).toMatchObject([
    { settings: { modeling: { base_unit: 'mm' } } },
    { settings: { modeling: { base_unit: 'in' } } },
  ])
})

it('releases a borrowed native context once when disposal is requested concurrently', async () => {
  const freed = vi.fn()
  class Context extends wasm.Context {
    free() {
      freed()
      // Keep a broken implementation from passing the same pointer to WASM twice.
      if (freed.mock.calls.length === 1) super.free()
    }
  }
  const model = await runtime({ ...wasm, Context })
  const pending = Promise.withResolvers<undefined>()
  let release = () => {}
  const lease = model.borrowModel(async () => {
    await pending.promise
    release()
  })
  if (lease instanceof Error) throw lease
  release = lease.release
  const first = model.dispose()
  const second = model.dispose()
  expect(freed).not.toHaveBeenCalled()
  pending.resolve(undefined)
  await Promise.all([first, second])
  expect(freed).toHaveBeenCalledOnce()
})
