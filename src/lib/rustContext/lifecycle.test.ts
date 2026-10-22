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
    parseForExecution = vi
      .fn<NativeContextContract['parseForExecution']>()
      .mockResolvedValue(parsedPlanes(1))
    new_sketch = vi
      .fn<NativeContextContract['new_sketch']>()
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
const imported: ApiFile = {
  id: 1,
  path: '/project/import.kcl',
  text: 'imported code',
}

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
    kcl_version: null,
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

  it.each(['connection', 'project', 'runtime', 'destroy'])(
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
      } else if (retired === 'project') {
        await context.sendOpenProject('/replacement/main.kcl', [
          { ...main, path: '/replacement/main.kcl' },
        ])
      } else if (retired === 'runtime') {
        await context.replaceWasmInstance(
          Promise.resolve(runtime('replacement').module)
        )
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

  it('replays current unsaved files into a fresh context', async () => {
    const first = runtime('first')
    const replacement = runtime('replacement')
    const context = owner(Promise.resolve(first.module))
    await context.sendOpenProject(main.path, [main, imported])
    await context.sendUpdateFile(main.id, 'unsaved edit')
    await context.sendRemoveFile(imported.id)
    const added = { ...imported, id: 2, text: 'new file' }
    await context.sendAddFile(added)
    await context.replaceWasmInstance(Promise.resolve(replacement.module))
    expect(
      replacement.instances[0].open_project
    ).toHaveBeenCalledExactlyOnceWith(
      0,
      JSON.stringify([{ ...main, text: 'unsaved edit' }, added]),
      0
    )
    await expect(context.getProjectState()).resolves.toEqual({
      module: 'replacement',
    })
    expect(first.instances[0].get_project).not.toHaveBeenCalled()
    await expect(context.wasmInstancePromise).resolves.toBe(replacement.module)
    context.destroy()
  })

  it('retains edits received while a replacement module is loading', async () => {
    const first = runtime('first')
    const next = runtime('next')
    const module = Promise.withResolvers<ModuleType>()
    const context = owner(Promise.resolve(first.module))
    await context.sendOpenProject(main.path, [main])
    const replacement = context.replaceWasmInstance(module.promise)
    const edit = context.sendUpdateFile(main.id, 'edit during recovery')
    const addition = context.sendAddFile(imported)
    module.resolve(next.module)
    await Promise.all([replacement, edit, addition])
    expect(next.instances[0].open_project).toHaveBeenCalledExactlyOnceWith(
      0,
      JSON.stringify([{ ...main, text: 'edit during recovery' }, imported]),
      0
    )
    expect(next.instances[0].update_file).not.toHaveBeenCalled()
    expect(next.instances[0].add_file).not.toHaveBeenCalled()
    context.destroy()
  })

  it('replays again when unsaved edits arrive during native registration', async () => {
    const first = runtime('first')
    const registration = Promise.withResolvers<undefined>()
    const open = vi
      .fn<ContextOpen>()
      .mockReturnValueOnce(registration.promise)
      .mockResolvedValue(undefined)
    const next = runtime('next', open)
    const context = owner(Promise.resolve(first.module))
    await context.sendOpenProject(main.path, [main])
    const replacement = context.replaceWasmInstance(
      Promise.resolve(next.module)
    )
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce())
    const edit = context.sendUpdateFile(main.id, 'newest edit')
    registration.resolve(undefined)
    await Promise.all([replacement, edit])
    expect(open).toHaveBeenLastCalledWith(
      0,
      JSON.stringify([{ ...main, text: 'newest edit' }]),
      0
    )
    expect(open).toHaveBeenCalledTimes(2)
    expect(context.hasOpenedProject).toBe(true)
    context.destroy()
  })

  it('moves pending callers to the latest replacement without awaiting the obsolete module', async () => {
    const pending = Promise.withResolvers<ModuleType>()
    const obsolete = runtime('obsolete')
    const latest = runtime('latest')
    const context = owner(pending.promise)
    const waiting = context.getProjectState()
    await context.replaceWasmInstance(Promise.resolve(latest.module))
    await expect(waiting).resolves.toEqual({ module: 'latest' })
    pending.resolve(obsolete.module)
    await pending.promise
    await expect(context.getProjectState()).resolves.toEqual({
      module: 'latest',
    })
    expect(obsolete.instances).toHaveLength(0)
    context.destroy()
  })

  it('frees a superseded unpublished native handle only after its replay returns', async () => {
    const first = runtime('first')
    const registration = Promise.withResolvers<undefined>()
    const open = vi.fn<ContextOpen>().mockReturnValue(registration.promise)
    const obsolete = runtime('obsolete', open)
    const latest = runtime('latest')
    const context = owner(Promise.resolve(first.module))
    await context.sendOpenProject(main.path, [main])
    const olderReplacement = context.replaceWasmInstance(
      Promise.resolve(obsolete.module)
    )
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce())
    await context.replaceWasmInstance(Promise.resolve(latest.module))
    expect(obsolete.instances[0].free).not.toHaveBeenCalled()
    registration.resolve(undefined)
    await olderReplacement
    await vi.waitFor(() =>
      expect(obsolete.instances[0].free).toHaveBeenCalledOnce()
    )
    expect(first.instances[0].free).not.toHaveBeenCalled()
    await expect(context.getProjectState()).resolves.toEqual({
      module: 'latest',
    })
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
    await expect(
      context.replaceWasmInstance(Promise.resolve(first.module))
    ).rejects.toThrow('destroyed')
    expect(first.instances).toHaveLength(0)
  })
})
