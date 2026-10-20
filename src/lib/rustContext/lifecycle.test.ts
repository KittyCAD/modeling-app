import type { ApiFile } from '@rust/kcl-lib/bindings/FrontendApi'
import * as native from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'
import { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import RustContext from '@src/lib/rustContext'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { settingsMachine } from '@src/machines/settingsMachine'
import { describe, expect, it, vi } from 'vitest'
import { Actor } from 'xstate'

vi.mock('@rust/kcl-wasm-lib/pkg/kcl_wasm_lib', () => ({ Context: class {} }))
vi.mock('@src/machines/settingsMachine', async () => {
  const { createMachine } = await import('xstate')
  return { settingsMachine: createMachine({}) }
})
vi.mock('@src/lang/std/fileSystemManager', () => ({ projectFsManager: {} }))
vi.mock('@src/lang/wasm', () => ({
  ParseResult: class {},
  errFromErrWithOutputs: vi.fn(),
  execStateFromRust: vi.fn(),
}))

// Only the generated native boundary is mocked. The real JS owner allocates,
// snapshots, replays, replaces, and disposes these native handles.
function runtime(
  label: string,
  open = vi.fn<ContextOpen>().mockResolvedValue(undefined)
) {
  const instances: NativeContext[] = []
  class NativeContext extends native.Context {
    constructor(...args: ConstructorParameters<typeof native.Context>) {
      super(...args)
      instances.push(this)
    }
    open_project = open
    add_file = vi.fn<native.Context['add_file']>().mockResolvedValue(undefined)
    update_file = vi
      .fn<native.Context['update_file']>()
      .mockResolvedValue(undefined)
    remove_file = vi
      .fn<native.Context['remove_file']>()
      .mockResolvedValue(undefined)
    get_project = vi.fn(async () => ({ module: label }))
    free = vi.fn()
  }
  return { module: { ...native, Context: NativeContext }, instances }
}

type ContextOpen = native.Context['open_project']
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

describe('RustContext module lifecycle', () => {
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
