import type { ApiFile } from '@rust/kcl-lib/bindings/FrontendApi'
import type { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'
import type { ParsedExecutionSource } from '@rust/kcl-lib/bindings/ParsedExecutionSource'
import { Connection } from '@src/lib/engineConnection/connection'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { getModule, type ModuleType } from '@src/lib/wasm_lib_wrapper'
import { settingsMachine } from '@src/machines/settingsMachine'
import { describe, expect, it, vi } from 'vitest'
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

const native = getModule()
type NativeContextContract = InstanceType<ModuleType['Context']>

// Only the source-owned Wasm boundary is mocked. The real JS owner allocates,
// snapshots, replays, replaces, and disposes these native handles.
function runtime(
  label: string,
  open = vi.fn<ContextOpen>().mockResolvedValue(undefined)
) {
  const instances: NativeContext[] = []
  class NativeContext extends native.Context {
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
      .mockResolvedValue(parsedPlanes(1))
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
  return { module: { ...native, Context: NativeContext }, instances }
}

type ContextOpen = NativeContextContract['open_project']
const main: ApiFile = { id: 0, path: '/project/main.kcl', text: 'initial code' }

function owner(module: Promise<ModuleType>) {
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

function parsedPlanes(
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

function planeOwner() {
  const first = runtime('planes')
  const settingsActor = new Actor(settingsMachine)
  const manager = new ConnectionManager({ settingsActor })
  const context = new RustContext(
    Promise.resolve(first.module),
    manager,
    settingsActor
  )
  const notification = vi.fn()
  context.planesCreated.add(notification)
  const parse = () => context.parseForExecution('', {})
  return { first, manager, context, notification, parse }
}

describe('RustContext plane notifications', () => {
  it('suppresses only an unchanged owned scene, not recreated planes with the same IDs', async () => {
    const { first, context, notification, parse } = planeOwner()
    await parse()
    await parse()
    expect(notification).toHaveBeenCalledTimes(1)
    first.instances[0].parseForExecution.mockResolvedValue(parsedPlanes(2))
    await parse()
    expect(notification).toHaveBeenCalledTimes(2)
    expect(context.defaultPlanes).toEqual(planes)
    context.destroy()
  })

  it('publishes changed plane IDs even within one scene generation', async () => {
    const { first, context, notification, parse } = planeOwner()
    await parse()
    const changed = { ...planes, xy: 'new-xy' }
    first.instances[0].parseForExecution.mockResolvedValue(
      parsedPlanes(1, changed)
    )
    await parse()
    expect(notification).toHaveBeenCalledTimes(2)
    expect(context.defaultPlanes).toEqual(changed)
    context.destroy()
  })

  it('does not let a retired scene receipt overwrite a newer scene', async () => {
    const { first, context, notification, parse } = planeOwner()
    await parse()
    const changed = { ...planes, xy: 'new-xy' }
    first.instances[0].parseForExecution.mockResolvedValue(
      parsedPlanes(2, changed)
    )
    await parse()
    first.instances[0].parseForExecution.mockResolvedValue(parsedPlanes(1))
    await parse()
    expect(notification).toHaveBeenCalledTimes(2)
    expect(context.defaultPlanes).toEqual(changed)
    context.destroy()
  })

  it.each(['connection', 'project', 'reopened project', 'destroy'])(
    'does not publish an old result after its %s owner retires',
    async (retired) => {
      const { first, manager, context, notification, parse } = planeOwner()
      await context.sendOpenProject(main.path, [main])
      const pending = Promise.withResolvers<ParsedExecutionSource>()
      first.instances[0].parseForExecution.mockReturnValueOnce(pending.promise)
      const oldResult = parse()
      await vi.waitFor(() =>
        expect(first.instances[0].parseForExecution).toHaveBeenCalledOnce()
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
          { ...main, path: '/replacement/main.kcl' },
        ])
        if (retired === 'reopened project')
          await context.sendOpenProject(main.path, [main])
      } else context.destroy()
      if (retired !== 'destroy') await parse()
      const before = notification.mock.calls.length
      pending.resolve(parsedPlanes(1, { ...planes, xy: 'retired-xy' }))
      await oldResult
      expect(notification).toHaveBeenCalledTimes(before)
      expect(context.defaultPlanes).toEqual(
        retired === 'destroy' ? null : planes
      )
      if (retired !== 'destroy') {
        await parse()
        expect(notification).toHaveBeenCalledTimes(before)
      }
      context.destroy()
    }
  )

  it('replays after a null result and conservatively publishes errors without a generation', async () => {
    const { first, context, notification, parse } = planeOwner()
    await parse()
    first.instances[0].parseForExecution.mockResolvedValueOnce(
      parsedPlanes(1, null)
    )
    await parse()
    expect(context.defaultPlanes).toBeNull()
    await parse()
    expect(notification).toHaveBeenCalledTimes(2)
    const known = Object.assign(new Error('known scene'), {
      defaultPlanes: planes,
      engineSceneGeneration: 1,
    })
    first.instances[0].parseForExecution.mockRejectedValueOnce(known)
    expect(await parse()).toBe(known)
    expect(notification).toHaveBeenCalledTimes(2)
    const unknown = Object.assign(new Error('unknown scene'), {
      defaultPlanes: planes,
      engineSceneGeneration: null,
    })
    first.instances[0].parseForExecution.mockRejectedValueOnce(unknown)
    expect(await parse()).toBe(unknown)
    expect(notification).toHaveBeenCalledTimes(3)
    await parse()
    expect(notification).toHaveBeenCalledTimes(4)
    context.destroy()
  })
})

describe('RustContext module lifecycle', () => {
  it.each(['add', 'chain'] as const)(
    'checks once before a logical %s insertion without interrupting its native mutations',
    async (operation) => {
      vi.useFakeTimers()
      const native = runtime('insertion')
      const settings = new Actor(settingsMachine)
      const gate = Promise.withResolvers<undefined>()
      const before = vi.fn(() => gate.promise)
      const context = new RustContext(
        Promise.resolve(native.module),
        new ConnectionManager({ settingsActor: settings }),
        settings,
        0,
        before
      )
      const segment = {
        type: 'Point',
        position: {
          x: { type: 'Var', value: 1, units: 'Mm' },
          y: { type: 'Var', value: 2, units: 'Mm' },
        },
      } as const
      try {
        const call = (async () => {
          await context.prepareForSketchInsertion()
          return operation === 'add'
            ? context.addSegment(0, 1, segment, undefined, {})
            : context.chainSegment(0, 1, 2, segment, undefined, {})
        })()
        const result = expect(call).rejects.toThrow(
          'Native sketch boundary reached'
        )
        await vi.advanceTimersByTimeAsync(7_000)
        expect(before).toHaveBeenCalledOnce()
        expect(native.instances[0].add_segment).not.toHaveBeenCalled()
        expect(native.instances[0].chain_segment).not.toHaveBeenCalled()
        gate.resolve(undefined)
        await result
        expect(
          operation === 'add'
            ? native.instances[0].add_segment
            : native.instances[0].chain_segment
        ).toHaveBeenCalledOnce()
        await expect(context.editSegments(0, 1, [], {})).rejects.toThrow(
          'Native sketch boundary reached'
        )
        expect(native.instances[0].edit_segments).toHaveBeenCalledOnce()
        expect(before).toHaveBeenCalledOnce()
        before.mockRejectedValueOnce(new Error('Cannot refresh storage'))
        await expect(context.prepareForSketchInsertion()).rejects.toThrow(
          'Cannot refresh storage'
        )
        expect(native.instances[0].add_segment).toHaveBeenCalledTimes(
          operation === 'add' ? 1 : 0
        )
      } finally {
        gate.resolve(undefined)
        context.destroy()
        vi.useRealTimers()
      }
    }
  )

  it.each(['newSketch', 'editSketch', 'exitSketch'])(
    '%s inherits current complete settings',
    async (operation) => {
      const native = runtime('settings')
      const context = owner(Promise.resolve(native.module))
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
      // Stop at the native boundary: this test owns the arguments, while the
      // real-engine lifecycle case owns successful geometry and cache behavior.
      const invoke = async () => {
        const settings = JSON.stringify(jsAppSettings(context.settingsActor))
        if (operation === 'newSketch') {
          await context
            .newSketch(0, 0, 0, { on: { default: 'xy' } })
            .catch(() => undefined)
          expect(native.instances[0].new_sketch).toHaveBeenLastCalledWith(
            '0',
            '0',
            '0',
            JSON.stringify({ on: { default: 'xy' } }),
            settings
          )
        } else if (operation === 'editSketch') {
          await context.editSketch(0, 0, 0, 1).catch(() => undefined)
          expect(native.instances[0].edit_sketch).toHaveBeenLastCalledWith(
            '0',
            '0',
            '0',
            '1',
            settings
          )
        } else {
          await context.exitSketch(0, 1).catch(() => undefined)
          expect(native.instances[0].exit_sketch).toHaveBeenLastCalledWith(
            '0',
            '1',
            settings
          )
        }
      }
      await invoke()
      modeling.backfaceColor.user = '#654321'
      await invoke()
      context.destroy()
    }
  )

  it('registers a project arriving before initialization once, including file zero', async () => {
    const module = Promise.withResolvers<ModuleType>()
    const first = runtime('first')
    const context = owner(module.promise)
    const open = context.sendOpenProject(main.path, [main])
    module.resolve(first.module)
    await open
    expect(first.instances).toHaveLength(1)
    expect(first.instances[0].open_project).toHaveBeenCalledExactlyOnceWith(
      0,
      JSON.stringify([main]),
      0
    )
    expect(context.hasOpenedProject).toBe(true)
    context.destroy()
  })

  it('does not resurrect an owner destroyed before initialization finishes', async () => {
    const pending = Promise.withResolvers<ModuleType>()
    const first = runtime('first')
    const context = owner(pending.promise)
    const waiting = context.getProjectState()
    const rejected = expect(waiting).rejects.toThrow('destroyed')
    context.destroy()
    await rejected
    pending.resolve(first.module)
    await pending.promise
    expect(first.instances).toHaveLength(0)
  })
})

describe('borrowed native context hosts', () => {
  function borrowed(label: string, pendingOpen?: Promise<void>) {
    const native = runtime(
      label,
      vi.fn<ContextOpen>(() => pendingOpen ?? Promise.resolve())
    )
    const settingsActor = new Actor(settingsMachine)
    const manager = new ConnectionManager({ settingsActor })
    const context = new native.module.Context(manager, {}, undefined)
    let tail: Promise<unknown> = Promise.resolve()
    const adapter = new RustContext(
      Promise.resolve(native.module),
      manager,
      settingsActor,
      0,
      undefined,
      {
        create: async () => context,
        deliverResponse: (work) => work(),
        run: <T>(work: () => Promise<T>) => {
          const next = tail.then(work)
          tail = next.catch(() => undefined)
          return next
        },
      }
    )
    return { adapter, context, native }
  }

  it('uses the supplied native model and keeps sibling adapters independent', async () => {
    const first = borrowed('first'),
      second = borrowed('second')
    try {
      expect(await first.adapter.getProjectState()).toEqual({ module: 'first' })
      expect(await second.adapter.getProjectState()).toEqual({
        module: 'second',
      })
      expect(first.native.instances).toHaveLength(1)
      expect(second.native.instances).toHaveLength(1)
      first.adapter.destroy()
      await expect(first.adapter.getProjectState()).rejects.toThrow('destroyed')
      expect(await second.adapter.getProjectState()).toEqual({
        module: 'second',
      })
      expect(first.context.free).not.toHaveBeenCalled()
    } finally {
      first.adapter.destroy()
      second.adapter.destroy()
    }
  })

  it('queues legacy operations behind pending work and rejects queued operations after adapter closure', async () => {
    const pending = Promise.withResolvers<undefined>(),
      first = borrowed('first', pending.promise),
      second = borrowed('second')
    const opening = first.adapter.sendOpenProject(main.path, [main])
    try {
      await vi.waitFor(() =>
        expect(first.context.open_project).toHaveBeenCalledOnce()
      )
      const queued = first.adapter.getProjectState()
      const failure = expect(queued).rejects.toThrow('destroyed')
      expect(first.context.get_project).not.toHaveBeenCalled()
      expect(await second.adapter.getProjectState()).toEqual({
        module: 'second',
      })
      first.adapter.destroy()
      pending.resolve(undefined)
      await opening
      await failure
      expect(first.context.get_project).not.toHaveBeenCalled()
      expect(first.context.free).not.toHaveBeenCalled()
    } finally {
      pending.resolve(undefined)
      first.adapter.destroy()
      second.adapter.destroy()
    }
  })
  it('applies an update submitted while project opening is pending', async () => {
    const pending = Promise.withResolvers<undefined>()
    const current = borrowed('updates', pending.promise)
    const opening = current.adapter.sendOpenProject(main.path, [main])
    try {
      await vi.waitFor(() =>
        expect(current.context.open_project).toHaveBeenCalledOnce()
      )
      const update = current.adapter.sendUpdateFile(main.id, 'changed code')
      expect(current.context.update_file).not.toHaveBeenCalled()
      pending.resolve(undefined)
      await Promise.all([opening, update])
      expect(current.context.update_file).toHaveBeenCalledWith(
        0,
        main.id,
        'changed code'
      )
    } finally {
      pending.resolve(undefined)
      current.adapter.destroy()
    }
  })

  it('serializes angle and distance edits with the other borrowed operations', async () => {
    const pending = Promise.withResolvers<undefined>()
    const current = borrowed('constraints', pending.promise)
    const opening = current.adapter.sendOpenProject(main.path, [main])
    try {
      await vi.waitFor(() =>
        expect(current.context.open_project).toHaveBeenCalledOnce()
      )
      const angle = current.adapter.editAngleConstraint(
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
      const distance = current.adapter.editDistanceConstraint(
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
      const angleFailure = expect(angle).rejects.toThrow(
        'Native angle boundary reached'
      )
      const distanceFailure = expect(distance).rejects.toThrow(
        'Native distance boundary reached'
      )
      await Promise.resolve()
      expect(current.context.edit_angle_constraint).not.toHaveBeenCalled()
      expect(current.context.edit_distance_constraint).not.toHaveBeenCalled()
      pending.resolve(undefined)
      await Promise.all([opening, angleFailure, distanceFailure])
      expect(current.context.edit_angle_constraint).toHaveBeenCalledOnce()
      expect(current.context.edit_distance_constraint).toHaveBeenCalledOnce()
    } finally {
      pending.resolve(undefined)
      current.adapter.destroy()
    }
  })

  it('delivers engine replies while an operation is occupying the native queue', async () => {
    const pending = Promise.withResolvers<undefined>(),
      current = borrowed('current', pending.promise)
    const opening = current.adapter.sendOpenProject(main.path, [main])
    try {
      await vi.waitFor(() =>
        expect(current.context.open_project).toHaveBeenCalledOnce()
      )
      const response = current.adapter.sendResponse({
        success: false,
        request_id: 'request',
        errors: [],
      })
      await vi.waitFor(() =>
        expect(current.context.sendResponse).toHaveBeenCalledOnce()
      )
      await response
      expect(current.context.open_project).toHaveBeenCalledOnce()
    } finally {
      pending.resolve(undefined)
      await opening
      current.adapter.destroy()
    }
  })
})
