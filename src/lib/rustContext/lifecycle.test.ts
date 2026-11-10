import type { ApiFile } from '@rust/kcl-lib/bindings/FrontendApi'
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

function owner(module: Promise<ModuleType>) {
  const settingsActor = new Actor(settingsMachine)
  const manager = new ConnectionManager({ settingsActor })
  return new RustContext(module, manager, settingsActor)
}

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
