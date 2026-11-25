import type { ApiFile } from '@rust/kcl-lib/bindings/FrontendApi'
import type { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'
import type { ParsedExecutionSource } from '@rust/kcl-lib/bindings/ParsedExecutionSource'
import { Connection } from '@src/lib/engineConnection/connection'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { getModule, type ModuleType } from '@src/lib/wasm_lib_wrapper'
import { settingsMachine } from '@src/machines/settingsMachine'
import { assert, describe, expect, it, vi } from 'vitest'
import { Actor } from 'xstate'

vi.mock('@src/lib/wasm_lib_wrapper', () => ({
  getModule: () => ({ Context: class {} }),
}))
vi.mock('@src/machines/settingsMachine', async () => {
  const { createMachine } = await import('xstate')
  const { createSettings } = await import('@src/lib/settings/initialSettings')
  return {
    settingsMachine: createMachine({ context: () => createSettings() }),
  }
})
vi.mock('@src/lang/std/fileSystemManager', () => ({ projectFsManager: {} }))
vi.mock('@src/lang/wasm', () => ({
  ParseResult: class {},
  errFromErrWithOutputs: vi.fn((error: unknown) => error),
  execStateFromRust: vi.fn(),
}))

const wasmStub = getModule()
type NativeContextContract = InstanceType<ModuleType['Context']>

// Replace WASM methods so these tests can pause native calls and inspect their
// arguments. RustContext itself is real; no WASM bundle or engine is needed.
function createNativeModule(
  label: string,
  open = vi.fn<ContextOpen>().mockResolvedValue(undefined)
) {
  const instances: NativeContext[] = []
  class NativeContext extends wasmStub.Context {
    constructor(...args: ConstructorParameters<ModuleType['Context']>) {
      super(...args)
      instances.push(this)
    }
    open_project = open
    add_file = vi
      .fn<NativeContextContract['add_file']>()
      .mockResolvedValue(undefined)
    update_file = vi
      .fn<NativeContextContract['update_file']>()
      .mockResolvedValue(undefined)
    remove_file = vi
      .fn<NativeContextContract['remove_file']>()
      .mockResolvedValue(undefined)
    get_project = vi.fn(async () => ({ module: label }))
    sendResponse = vi.fn(async () => {})
    edit_angle_constraint = vi.fn(async () => {
      throw new Error('Native angle boundary reached')
    })
    edit_distance_constraint = vi.fn(async () => {
      throw new Error('Native distance boundary reached')
    })
    parseForExecution = vi
      .fn<NativeContextContract['parseForExecution']>()
      .mockResolvedValue(parsedSourceWithPlanes(1))
    new_sketch = vi
      .fn<NativeContextContract['new_sketch']>()
      .mockRejectedValue(new Error('Native sketch boundary reached'))
    add_segment = vi
      .fn<NativeContextContract['add_segment']>()
      .mockRejectedValue(new Error('Native sketch boundary reached'))
    chain_segment = vi
      .fn<NativeContextContract['chain_segment']>()
      .mockRejectedValue(new Error('Native sketch boundary reached'))
    edit_segments = vi
      .fn<NativeContextContract['edit_segments']>()
      .mockRejectedValue(new Error('Native sketch boundary reached'))
    edit_sketch = vi
      .fn<NativeContextContract['edit_sketch']>()
      .mockRejectedValue(new Error('Native sketch boundary reached'))
    exit_sketch = vi
      .fn<NativeContextContract['exit_sketch']>()
      .mockRejectedValue(new Error('Native sketch boundary reached'))
    free = vi.fn()
  }
  return {
    module: { ...wasmStub, Context: NativeContext },
    instances,
    get instance() {
      const instance = instances[0]
      assert(
        instance,
        'Expected RustContext to have acquired its native context'
      )
      return instance
    },
  }
}

type ContextOpen = NativeContextContract['open_project']
const mainFile: ApiFile = {
  id: 0,
  path: '/project/main.kcl',
  text: 'initial code',
}

function createRustContext(module: Promise<ModuleType>) {
  const settingsActor = new Actor(settingsMachine)
  const manager = new ConnectionManager({ settingsActor })
  return new RustContext(module, manager, settingsActor)
}

const planes: DefaultPlanes = {
  xy: 'xy',
  xz: 'xz',
  yz: 'yz',
  negXy: '-xy',
  negXz: '-xz',
  negYz: '-yz',
}

function parsedSourceWithPlanes(
  generation: number,
  value: DefaultPlanes | null = planes
): ParsedExecutionSource {
  return {
    program: null,
    issues: [],
    default_planes: value,
    engine_scene_generation: generation,
  }
}

function createPlaneFixture() {
  const nativeModule = createNativeModule('planes')
  const settingsActor = new Actor(settingsMachine)
  const manager = new ConnectionManager({ settingsActor })
  const context = new RustContext(
    Promise.resolve(nativeModule.module),
    manager,
    settingsActor
  )
  const notification = vi.fn()
  context.planesCreated.add(notification)
  const parse = () => context.parseForExecution('', {})
  return { nativeModule, manager, context, notification, parse }
}

describe('RustContext plane notifications', () => {
  it('notifies once for unchanged planes and again when a rebuilt scene reuses their IDs', async () => {
    const { nativeModule, context, notification, parse } = createPlaneFixture()
    await parse()
    await parse()
    expect(notification).toHaveBeenCalledTimes(1)
    nativeModule.instance.parseForExecution.mockResolvedValue(
      parsedSourceWithPlanes(2)
    )
    await parse()
    expect(notification).toHaveBeenCalledTimes(2)
    expect(context.defaultPlanes).toEqual(planes)
    context.destroy()
  })

  it('notifies when plane IDs change without a scene rebuild', async () => {
    const { nativeModule, context, notification, parse } = createPlaneFixture()
    await parse()
    const changed = { ...planes, xy: 'new-xy' }
    nativeModule.instance.parseForExecution.mockResolvedValue(
      parsedSourceWithPlanes(1, changed)
    )
    await parse()
    expect(notification).toHaveBeenCalledTimes(2)
    expect(context.defaultPlanes).toEqual(changed)
    context.destroy()
  })

  it('ignores plane results from an older scene generation', async () => {
    const { nativeModule, context, notification, parse } = createPlaneFixture()
    await parse()
    const changed = { ...planes, xy: 'new-xy' }
    nativeModule.instance.parseForExecution.mockResolvedValue(
      parsedSourceWithPlanes(2, changed)
    )
    await parse()
    nativeModule.instance.parseForExecution.mockResolvedValue(
      parsedSourceWithPlanes(1)
    )
    await parse()
    expect(notification).toHaveBeenCalledTimes(2)
    expect(context.defaultPlanes).toEqual(changed)
    context.destroy()
  })

  it.each([
    { retired: 'connection', change: 'the engine connection changes' },
    { retired: 'project', change: 'another project opens' },
    {
      retired: 'reopened project',
      change: 'the same project closes and reopens',
    },
    { retired: 'destroy', change: 'the RustContext is destroyed' },
  ])('ignores a pending plane result after $change', async ({ retired }) => {
    const { nativeModule, manager, context, notification, parse } =
      createPlaneFixture()
    await context.sendOpenProject(mainFile.path, [mainFile])
    const oldParseFinished = Promise.withResolvers<ParsedExecutionSource>()
    nativeModule.instance.parseForExecution.mockReturnValueOnce(
      oldParseFinished.promise
    )
    const oldResult = parse()
    await vi.waitFor(() =>
      expect(nativeModule.instance.parseForExecution).toHaveBeenCalledOnce()
    )
    if (retired === 'connection') {
      manager.connection = new Connection({
        url: 'ws://localhost/planes',
        token: 'test-token',
        handleOnDataChannelMessage: vi.fn(),
        recordShutdownTrigger: () => false,
        tearDownManager: vi.fn(),
        rejectPendingCommand: vi.fn(),
        handleMessage: vi.fn(),
        getCloudProjectId: () => undefined,
      })
    } else if (retired === 'project' || retired === 'reopened project') {
      await context.sendOpenProject('/replacement/main.kcl', [
        { ...mainFile, path: '/replacement/main.kcl' },
      ])
      if (retired === 'reopened project')
        await context.sendOpenProject(mainFile.path, [mainFile])
    } else context.destroy()
    if (retired !== 'destroy') await parse()
    const notificationsBeforeOldResult = notification.mock.calls.length
    oldParseFinished.resolve(
      parsedSourceWithPlanes(1, { ...planes, xy: 'retired-xy' })
    )
    await oldResult
    expect(notification).toHaveBeenCalledTimes(notificationsBeforeOldResult)
    expect(context.defaultPlanes).toEqual(retired === 'destroy' ? null : planes)
    if (retired !== 'destroy') {
      await parse()
      expect(notification).toHaveBeenCalledTimes(notificationsBeforeOldResult)
    }
    context.destroy()
  })

  it('notifies when planes return after a null result and when their scene generation is unknown', async () => {
    const { nativeModule, context, notification, parse } = createPlaneFixture()
    await parse()
    nativeModule.instance.parseForExecution.mockResolvedValueOnce(
      parsedSourceWithPlanes(1, null)
    )
    await parse()
    expect(context.defaultPlanes).toBeNull()
    await parse()
    expect(notification).toHaveBeenCalledTimes(2)
    const known = Object.assign(new Error('known scene'), {
      defaultPlanes: planes,
      engineSceneGeneration: 1,
    })
    nativeModule.instance.parseForExecution.mockRejectedValueOnce(known)
    expect(await parse()).toBe(known)
    expect(notification).toHaveBeenCalledTimes(2)
    const unknown = Object.assign(new Error('unknown scene'), {
      defaultPlanes: planes,
      engineSceneGeneration: null,
    })
    nativeModule.instance.parseForExecution.mockRejectedValueOnce(unknown)
    expect(await parse()).toBe(unknown)
    expect(notification).toHaveBeenCalledTimes(3)
    await parse()
    expect(notification).toHaveBeenCalledTimes(4)
    context.destroy()
  })
})

describe('RustContext initialization and sketch operations', () => {
  it.each(['add', 'chain'] as const)(
    'waits for storage preparation before %s and does not repeat it for later segment edits',
    async (operation) => {
      vi.useFakeTimers()
      const native = createNativeModule('insertion')
      const settings = new Actor(settingsMachine)
      const storageReady = Promise.withResolvers<undefined>()
      const prepareStorage = vi.fn(() => storageReady.promise)
      const context = new RustContext(
        Promise.resolve(native.module),
        new ConnectionManager({ settingsActor: settings }),
        settings,
        0,
        prepareStorage
      )
      const segment = {
        type: 'Point',
        position: {
          x: { type: 'Var', value: 1, units: 'Mm' },
          y: { type: 'Var', value: 2, units: 'Mm' },
        },
      } as const
      try {
        const insertion = (async () => {
          await context.prepareForSketchInsertion()
          return operation === 'add'
            ? context.addSegment(0, 1, segment, undefined, {})
            : context.chainSegment(0, 1, 2, segment, undefined, {})
        })()
        const rejectedInsertion = expect(insertion).rejects.toThrow(
          'Native sketch boundary reached'
        )
        // Keep storage preparation pending to catch unwanted retries or timeouts.
        await vi.advanceTimersByTimeAsync(7_000)
        expect(prepareStorage).toHaveBeenCalledOnce()
        expect(native.instance.add_segment).not.toHaveBeenCalled()
        expect(native.instance.chain_segment).not.toHaveBeenCalled()
        storageReady.resolve(undefined)
        await rejectedInsertion
        expect(
          operation === 'add'
            ? native.instance.add_segment
            : native.instance.chain_segment
        ).toHaveBeenCalledOnce()
        await expect(context.editSegments(0, 1, [], {})).rejects.toThrow(
          'Native sketch boundary reached'
        )
        expect(native.instance.edit_segments).toHaveBeenCalledOnce()
        expect(prepareStorage).toHaveBeenCalledOnce()
        prepareStorage.mockRejectedValueOnce(
          new Error('Cannot refresh storage')
        )
        await expect(context.prepareForSketchInsertion()).rejects.toThrow(
          'Cannot refresh storage'
        )
        expect(native.instance.add_segment).toHaveBeenCalledTimes(
          operation === 'add' ? 1 : 0
        )
      } finally {
        storageReady.resolve(undefined)
        context.destroy()
        vi.useRealTimers()
      }
    }
  )

  it.each(['newSketch', 'editSketch', 'exitSketch'])(
    '%s forwards the current modeling settings on each call',
    async (operation) => {
      const native = createNativeModule('settings')
      const context = createRustContext(Promise.resolve(native.module))
      const { modeling } = context.settingsActor.getSnapshot().context
      modeling.defaultUnit.user = 'in'
      modeling.enableSSAO.user = false
      modeling.fixedSizeGrid.user = false
      modeling.backfaceColor.user = '#123456'
      expect(jsAppSettings(context.settingsActor)).toMatchObject({
        settings: {
          modeling: {
            base_unit: 'in',
            enable_ssao: false,
            fixed_size_grid: false,
            backface_color: '#123456',
          },
        },
      })
      // The fake native methods reject after receiving the call. This checks
      // settings forwarding without requiring geometry or an engine.
      const invokeAndCheckSettings = async () => {
        const settings = JSON.stringify(jsAppSettings(context.settingsActor))
        if (operation === 'newSketch') {
          await context
            .newSketch(0, 0, 0, { on: { default: 'xy' } })
            .catch(() => undefined)
          expect(native.instance.new_sketch).toHaveBeenLastCalledWith(
            '0',
            '0',
            '0',
            JSON.stringify({ on: { default: 'xy' } }),
            settings
          )
        } else if (operation === 'editSketch') {
          await context.editSketch(0, 0, 0, 1).catch(() => undefined)
          expect(native.instance.edit_sketch).toHaveBeenLastCalledWith(
            '0',
            '0',
            '0',
            '1',
            settings
          )
        } else {
          await context.exitSketch(0, 1).catch(() => undefined)
          expect(native.instance.exit_sketch).toHaveBeenLastCalledWith(
            '0',
            '1',
            settings
          )
        }
      }
      await invokeAndCheckSettings()
      modeling.backfaceColor.user = '#654321'
      await invokeAndCheckSettings()
      context.destroy()
    }
  )

  it('opens a project requested before WASM is ready and preserves entrypoint ID zero', async () => {
    const wasmReady = Promise.withResolvers<ModuleType>()
    const nativeModule = createNativeModule('first')
    const context = createRustContext(wasmReady.promise)
    const open = context.sendOpenProject(mainFile.path, [mainFile])
    wasmReady.resolve(nativeModule.module)
    await open
    expect(nativeModule.instances).toHaveLength(1)
    expect(nativeModule.instance.open_project).toHaveBeenCalledExactlyOnceWith(
      0,
      JSON.stringify([mainFile]),
      0
    )
    expect(context.hasOpenedProject).toBe(true)
    context.destroy()
  })

  it('rejects waiting calls and creates no native context if destroyed before WASM is ready', async () => {
    const wasmReady = Promise.withResolvers<ModuleType>()
    const nativeModule = createNativeModule('first')
    const context = createRustContext(wasmReady.promise)
    const waiting = context.getProjectState()
    const rejected = expect(waiting).rejects.toThrow('destroyed')
    context.destroy()
    await rejected
    wasmReady.resolve(nativeModule.module)
    await wasmReady.promise
    expect(nativeModule.instances).toHaveLength(0)
  })
})

describe('RustContext using a context owned by the KCL runtime', () => {
  // Model a runtime's context and queue without loading WASM. The real
  // RustContext wrapper must use both and leave memory ownership to the runtime.
  function createRuntimeAndWrapper(
    label: string,
    projectOpenFinished?: Promise<void>
  ) {
    const nativeModule = createNativeModule(
      label,
      vi.fn<ContextOpen>(() => projectOpenFinished ?? Promise.resolve())
    )
    const settingsActor = new Actor(settingsMachine)
    const manager = new ConnectionManager({ settingsActor })
    const nativeContext = new nativeModule.module.Context(
      manager,
      {},
      undefined
    )
    let queuedOperations: Promise<unknown> = Promise.resolve()
    const rustContext = new RustContext(
      Promise.resolve(nativeModule.module),
      manager,
      settingsActor,
      0,
      undefined,
      {
        create: async () => nativeContext,
        deliverResponse: (work) => work(),
        run: <T>(work: () => Promise<T>) => {
          const next = queuedOperations.then(work)
          queuedOperations = next.catch(() => undefined)
          return next
        },
      }
    )
    return { rustContext, nativeContext, nativeModule }
  }

  it('uses the existing runtime context and leaves the other wrapper usable after destruction', async () => {
    const first = createRuntimeAndWrapper('first')
    const second = createRuntimeAndWrapper('second')
    try {
      expect(await first.rustContext.getProjectState()).toEqual({
        module: 'first',
      })
      expect(await second.rustContext.getProjectState()).toEqual({
        module: 'second',
      })
      expect(first.nativeModule.instances).toHaveLength(1)
      expect(second.nativeModule.instances).toHaveLength(1)
      first.rustContext.destroy()
      await expect(first.rustContext.getProjectState()).rejects.toThrow(
        'destroyed'
      )
      expect(await second.rustContext.getProjectState()).toEqual({
        module: 'second',
      })
      expect(first.nativeContext.free).not.toHaveBeenCalled()
    } finally {
      first.rustContext.destroy()
      second.rustContext.destroy()
    }
  })

  it('rejects a queued project read when the wrapper is destroyed, without blocking another runtime', async () => {
    const projectOpenFinished = Promise.withResolvers<undefined>()
    const first = createRuntimeAndWrapper('first', projectOpenFinished.promise)
    const second = createRuntimeAndWrapper('second')
    const openProject = first.rustContext.sendOpenProject(mainFile.path, [
      mainFile,
    ])
    try {
      await vi.waitFor(() =>
        expect(first.nativeContext.open_project).toHaveBeenCalledOnce()
      )
      const readProject = first.rustContext.getProjectState()
      const rejectedRead = expect(readProject).rejects.toThrow('destroyed')
      expect(first.nativeContext.get_project).not.toHaveBeenCalled()
      expect(await second.rustContext.getProjectState()).toEqual({
        module: 'second',
      })
      first.rustContext.destroy()
      projectOpenFinished.resolve(undefined)
      await openProject
      await rejectedRead
      expect(first.nativeContext.get_project).not.toHaveBeenCalled()
      expect(first.nativeContext.free).not.toHaveBeenCalled()
    } finally {
      projectOpenFinished.resolve(undefined)
      first.rustContext.destroy()
      second.rustContext.destroy()
    }
  })
  it('waits for project opening before applying a file update', async () => {
    const projectOpenFinished = Promise.withResolvers<undefined>()
    const current = createRuntimeAndWrapper(
      'updates',
      projectOpenFinished.promise
    )
    const openProject = current.rustContext.sendOpenProject(mainFile.path, [
      mainFile,
    ])
    try {
      await vi.waitFor(() =>
        expect(current.nativeContext.open_project).toHaveBeenCalledOnce()
      )
      const updateFile = current.rustContext.sendUpdateFile(
        mainFile.id,
        'changed code'
      )
      expect(current.nativeContext.update_file).not.toHaveBeenCalled()
      projectOpenFinished.resolve(undefined)
      await Promise.all([openProject, updateFile])
      expect(current.nativeContext.update_file).toHaveBeenCalledWith(
        0,
        mainFile.id,
        'changed code'
      )
    } finally {
      projectOpenFinished.resolve(undefined)
      current.rustContext.destroy()
    }
  })

  it('queues angle and distance edits behind project opening', async () => {
    const projectOpenFinished = Promise.withResolvers<undefined>()
    const current = createRuntimeAndWrapper(
      'constraints',
      projectOpenFinished.promise
    )
    const openProject = current.rustContext.sendOpenProject(mainFile.path, [
      mainFile,
    ])
    try {
      await vi.waitFor(() =>
        expect(current.nativeContext.open_project).toHaveBeenCalledOnce()
      )
      const editAngle = current.rustContext.editAngleConstraint(
        0,
        1,
        2,
        {
          type: 'Angle',
          lines: [3, 4],
          angle: { value: 90, units: 'Deg' },
          source: { expr: '90deg', is_literal: true },
        },
        {}
      )
      const editDistance = current.rustContext.editDistanceConstraint(
        0,
        1,
        5,
        {
          type: 'Distance',
          segments: [],
          distance: { value: 5, units: 'Mm' },
          source: { expr: '5mm', is_literal: true },
        },
        {}
      )
      const rejectedAngleEdit = expect(editAngle).rejects.toThrow(
        'Native angle boundary reached'
      )
      const rejectedDistanceEdit = expect(editDistance).rejects.toThrow(
        'Native distance boundary reached'
      )
      await Promise.resolve()
      expect(current.nativeContext.edit_angle_constraint).not.toHaveBeenCalled()
      expect(
        current.nativeContext.edit_distance_constraint
      ).not.toHaveBeenCalled()
      projectOpenFinished.resolve(undefined)
      await Promise.all([openProject, rejectedAngleEdit, rejectedDistanceEdit])
      expect(current.nativeContext.edit_angle_constraint).toHaveBeenCalledOnce()
      expect(
        current.nativeContext.edit_distance_constraint
      ).toHaveBeenCalledOnce()
    } finally {
      projectOpenFinished.resolve(undefined)
      current.rustContext.destroy()
    }
  })

  it('delivers an engine reply before the queued project-opening operation finishes', async () => {
    const projectOpenFinished = Promise.withResolvers<undefined>()
    const current = createRuntimeAndWrapper(
      'current',
      projectOpenFinished.promise
    )
    const openProject = current.rustContext.sendOpenProject(mainFile.path, [
      mainFile,
    ])
    try {
      await vi.waitFor(() =>
        expect(current.nativeContext.open_project).toHaveBeenCalledOnce()
      )
      // A native call may need an engine reply to finish. Deliver the reply
      // while projectOpenFinished is still unresolved to catch queue deadlocks.
      const response = current.rustContext.sendResponse({
        success: false,
        request_id: 'request',
        errors: [],
      })
      await vi.waitFor(() =>
        expect(current.nativeContext.sendResponse).toHaveBeenCalledOnce()
      )
      await response
      expect(current.nativeContext.open_project).toHaveBeenCalledOnce()
    } finally {
      projectOpenFinished.resolve(undefined)
      await openProject
      current.rustContext.destroy()
    }
  })
})
