import type { MachineManager } from '@src/lib/MachineManager'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { createSettings } from '@src/lib/settings/initialSettings'
import type { BaseUnit } from '@src/lib/settings/settingsTypes'
import * as settingsUtils from '@src/lib/settings/settingsUtils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import {
  getOnlySettingsFromContext,
  settingsMachine,
  type SettingsMachineContext,
} from '@src/machines/settingsMachine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, fromCallback, fromPromise, waitFor } from 'xstate'

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn() },
}))

vi.mock('react-hot-toast', () => ({ default: mockToast }))

afterEach(() => vi.restoreAllMocks())

describe('settingsMachine', () => {
  it('keeps service dependencies out of settings values', () => {
    const settings = createSettings()
    const wasmInstancePromise = Promise.resolve({} as ModuleType)
    const commandBarActor = createActor(commandBarMachine, {
      input: {
        commands: [],
        wasmInstancePromise,
        machineManager: {} as MachineManager,
      },
    }).start()
    const context: SettingsMachineContext = {
      ...settings,
      commandBarActor,
      defaultProjectLibraries: [],
      projectLibrarySettingDefaultPolicies: [],
      extensionSettings: {},
      fileOperations: testFileOperations,
      wasmInstancePromise,
      deferredEvents: [],
    }

    expect(getOnlySettingsFromContext(context)).toEqual(settings)

    commandBarActor.stop()
  })

  it('serializes settings events received while persistence is pending', async () => {
    mockToast.success.mockClear()
    const persistedUnits: Array<BaseUnit | undefined> = []
    const persistedProjectPaths: Array<string | undefined> = []
    const projectPath = '/projects/bracket'
    const finishPersisting: Array<() => void> = []
    let activeWrites = 0
    let maximumActiveWrites = 0
    const initialSettings = createSettings()
    initialSettings.modeling.defaultUnit.user = 'in'
    const wasmInstancePromise = Promise.resolve({} as ModuleType)
    const commandBarActor = createActor(commandBarMachine, {
      input: {
        commands: [],
        wasmInstancePromise,
        machineManager: {} as MachineManager,
      },
    }).start()
    vi.spyOn(settingsUtils, 'saveSettings').mockImplementation(
      async (
        _fileOperations,
        _wasmInstancePromise,
        settings,
        _extensions,
        path
      ) => {
        persistedUnits.push(settings.modeling.defaultUnit.project)
        persistedProjectPaths.push(path)
        activeWrites += 1
        maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites)
        await new Promise<void>((resolve) => {
          finishPersisting.push(() => {
            activeWrites -= 1
            resolve()
          })
        })
      }
    )
    const actor = createActor(
      settingsMachine.provide({
        actors: {
          loadUserSettings: fromPromise(async () => initialSettings),
          registerCommands: fromCallback(() => () => {}),
          watchSystemTheme: fromCallback(() => () => {}),
        },
      }),
      {
        input: {
          commandBarActor,
          currentProject: {
            path: projectPath,
            name: 'bracket',
            metadata: null,
            children: [],
            kcl_file_count: 1,
            directory_count: 0,
            default_file: `${projectPath}/main.kcl`,
            readWriteAccess: true,
          },
          defaultProjectLibraries: [],
          projectLibrarySettingDefaultPolicies: [],
          extensionSettings: {},
          fileOperations: testFileOperations,
          ...initialSettings,
          wasmInstancePromise,
        },
      }
    ).start()

    await waitFor(actor, (snapshot) => snapshot.matches('idle'))

    actor.send({
      type: 'set.modeling.defaultUnit',
      data: { level: 'project', value: 'mm' },
    })
    actor.send({
      type: 'set.modeling.defaultUnit',
      data: { level: 'project', value: 'yd' },
    })
    actor.send({
      type: 'set.modeling.defaultUnit',
      data: { level: 'project', value: 'cm' },
    })
    actor.send({ type: 'Reset settings', level: 'user' })

    expect(actor.getSnapshot().context.deferredEvents).toHaveLength(3)
    expect(persistedUnits).toEqual(['mm'])
    expect(mockToast.success).not.toHaveBeenCalledWith(
      'Your user-level settings were reset.'
    )

    finishPersisting.shift()?.()
    await waitFor(
      actor,
      (snapshot) =>
        snapshot.matches('persisting settings') &&
        snapshot.context.modeling.defaultUnit.project === 'yd'
    )
    expect(persistedUnits).toEqual(['mm', 'yd'])

    finishPersisting.shift()?.()
    await waitFor(
      actor,
      (snapshot) =>
        snapshot.matches('persisting settings') &&
        snapshot.context.modeling.defaultUnit.project === 'cm'
    )
    expect(persistedUnits).toEqual(['mm', 'yd', 'cm'])

    finishPersisting.shift()?.()
    await waitFor(
      actor,
      (snapshot) =>
        snapshot.matches('persisting settings') &&
        snapshot.context.modeling.defaultUnit.user === undefined
    )
    expect(mockToast.success).toHaveBeenCalledWith(
      'Your user-level settings were reset.'
    )

    finishPersisting.shift()?.()
    await waitFor(actor, (snapshot) => snapshot.matches('idle'))

    expect(actor.getSnapshot().context.deferredEvents).toEqual([])
    expect(actor.getSnapshot().context.modeling.defaultUnit.project).toBe('cm')
    expect(persistedProjectPaths).toEqual([
      projectPath,
      projectPath,
      projectPath,
      undefined,
    ])
    expect(maximumActiveWrites).toBe(1)

    actor.stop()
    commandBarActor.stop()
  })
})

describe('settings edits during a disk reload', () => {
  it.each([false, true])(
    'preserves queued edits when reload rejects: %s',
    async (rejectReload) => {
      const diskSettings = createSettings()
      diskSettings.modeling.defaultUnit.project = 'mm'
      const persistedUnits: Array<BaseUnit | undefined> = []
      let finishReload!: () => void
      const reload = new Promise<typeof diskSettings>((resolve, reject) => {
        finishReload = () =>
          rejectReload
            ? reject(new Error('disk read failed'))
            : resolve(diskSettings)
      })
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      const wasmInstancePromise = Promise.resolve({} as ModuleType)
      const commandBarActor = createActor(commandBarMachine, {
        input: {
          commands: [],
          wasmInstancePromise,
          machineManager: {} as MachineManager,
        },
      }).start()
      const actor = createActor(
        settingsMachine.provide({
          actors: {
            loadUserSettings: fromPromise(async () => createSettings()),
            reloadSettings: fromPromise(() => reload),
            persistSettings: fromPromise(async ({ input }) => {
              persistedUnits.push(input.context.modeling.defaultUnit.project)
              return undefined
            }),
            registerCommands: fromCallback(() => () => {}),
            watchSystemTheme: fromCallback(() => () => {}),
          },
        }),
        {
          input: {
            ...createSettings(),
            commandBarActor,
            wasmInstancePromise,
            defaultProjectLibraries: [],
            projectLibrarySettingDefaultPolicies: [],
            extensionSettings: {},
            fileOperations: testFileOperations,
          },
        }
      ).start()
      try {
        await waitFor(actor, (snapshot) => snapshot.matches('idle'))
        actor.send({ type: 'reload.settings' })
        expect(actor.getSnapshot().matches('reloadingSettings')).toBe(true)
        actor.send({
          type: 'set.modeling.defaultUnit',
          data: { level: 'project', value: 'in' },
        })
        actor.send({
          type: 'set.modeling.defaultUnit',
          data: { level: 'project', value: 'ft' },
        })
        expect(persistedUnits).toEqual([])
        finishReload()
        await waitFor(actor, (snapshot) => snapshot.matches('idle'))
        expect(persistedUnits).toEqual(['in', 'ft'])
        expect(actor.getSnapshot().context.modeling.defaultUnit.project).toBe(
          'ft'
        )
        expect(actor.getSnapshot().context.deferredEvents).toEqual([])
        expect(consoleError).toHaveBeenCalledTimes(rejectReload ? 1 : 0)
      } finally {
        actor.stop()
        commandBarActor.stop()
        consoleError.mockRestore()
      }
    }
  )
})
