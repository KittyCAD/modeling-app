import type { MachineManager } from '@src/lib/MachineManager'
import { createSettings } from '@src/lib/settings/initialSettings'
import type { BaseUnit } from '@src/lib/settings/settingsTypes'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import { settingsMachine } from '@src/machines/settingsMachine'
import { describe, expect, it, vi } from 'vitest'
import { createActor, fromCallback, fromPromise, waitFor } from 'xstate'

describe('settingsMachine', () => {
  it('serializes settings events received while persistence is pending', async () => {
    const persistedUnits: Array<BaseUnit | undefined> = []
    const finishPersisting: Array<() => void> = []
    let activeWrites = 0
    let maximumActiveWrites = 0
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
          persistSettings: fromPromise(async ({ input }) => {
            persistedUnits.push(input.context.modeling.defaultUnit.project)
            activeWrites += 1
            maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites)
            await new Promise<void>((resolve) => {
              finishPersisting.push(() => {
                activeWrites -= 1
                resolve()
              })
            })
            return undefined
          }),
          registerCommands: fromCallback(() => () => {}),
          watchSystemTheme: fromCallback(() => () => {}),
        },
      }),
      {
        input: {
          commandBarActor,
          defaultProjectLibraries: [],
          projectLibrarySettingDefaultPolicies: [],
          extensionSettings: {},
          ...createSettings(),
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

    expect(actor.getSnapshot().context.deferredEvents).toHaveLength(2)
    expect(persistedUnits).toEqual(['mm'])

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
    await waitFor(actor, (snapshot) => snapshot.matches('idle'))

    expect(actor.getSnapshot().context.deferredEvents).toEqual([])
    expect(actor.getSnapshot().context.modeling.defaultUnit.project).toBe('cm')
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
