import { effect } from '@preact/signals-core'
import { MachineManager } from '@src/lib/MachineManager'
import { testFileOperations } from '@src/lib/fileSystem/testScheduler'
import { createSettings } from '@src/lib/settings/initialSettings'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import type { BaseUnit, SettingsLevel } from '@src/lib/settings/settingsTypes'
import * as settingsUtils from '@src/lib/settings/settingsUtils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { commandBarMachine } from '@src/machines/commandBarMachine'
import {
  getOnlySettingsFromContext,
  settingsMachine,
  type SettingsMachineContext,
  type SettingsMachineEvent,
} from '@src/machines/settingsMachine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, fromCallback, fromPromise, waitFor } from 'xstate'

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn() },
}))

vi.mock('react-hot-toast', () => ({ default: mockToast }))

afterEach(() => vi.restoreAllMocks())

function createColorSettingsHarness() {
  const initialSettings = createSettings()
  const wasmInstancePromise = new Promise<ModuleType>(() => {})
  const commandBarActor = createActor(commandBarMachine, {
    input: {
      commands: [],
      wasmInstancePromise,
      machineManager: new MachineManager(),
    },
  }).start()
  const writes: {
    user: string | undefined
    project: string | undefined
    path: string | undefined
    finish: () => void
    fail: () => void
  }[] = []
  let activeWrites = 0
  let maximumActiveWrites = 0
  vi.spyOn(settingsUtils, 'saveSettings').mockImplementation(
    async (_files, _wasm, settings, _extensions, path) => {
      activeWrites += 1
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites)
      // The real save also awaits Wasm before reading the Setting instances.
      await Promise.resolve()
      try {
        await new Promise<void>((resolve, reject) => {
          writes.push({
            user: settings.modeling.backfaceColor.user,
            project: settings.modeling.backfaceColor.project,
            path,
            finish: resolve,
            fail: () => reject(new Error('write failed')),
          })
        })
      } finally {
        activeWrites -= 1
      }
    }
  )
  let finishReload: (settings: SettingsType) => void = () => {
    throw new Error('Reload has not started')
  }
  const actor = createActor(
    settingsMachine.provide({
      actors: {
        loadUserSettings: fromPromise(async () => initialSettings),
        loadProjectSettings: fromPromise(async () => createSettings()),
        reloadSettings: fromPromise(
          () =>
            new Promise<SettingsType>((resolve) => {
              finishReload = resolve
            })
        ),
        registerCommands: fromCallback(() => () => {}),
        watchSystemTheme: fromCallback(() => () => {}),
      },
    }),
    {
      input: {
        ...initialSettings,
        currentProject: {
          path: '/projects/first',
          name: 'first',
          metadata: null,
          children: [],
          kcl_file_count: 1,
          directory_count: 0,
          default_file: '/projects/first/main.kcl',
          readWriteAccess: true,
        },
        commandBarActor,
        defaultProjectLibraries: [],
        projectLibrarySettingDefaultPolicies: [],
        extensionSettings: {},
        fileOperations: testFileOperations,
        wasmInstancePromise,
      },
    }
  ).start()
  return {
    actor,
    writes,
    setColor(
      value: string,
      level: SettingsLevel = 'user',
      doNotPersist = false
    ) {
      actor.send({
        type: 'set.modeling.backfaceColor',
        data: { level, value },
        doNotPersist,
      })
    },
    finishReload: (settings: SettingsType) => finishReload(settings),
    maximumActiveWrites: () => maximumActiveWrites,
    stop: () => {
      actor.stop()
      commandBarActor.stop()
    },
  }
}

describe('backface color persistence', () => {
  it.each([false, true])(
    'previews each color immediately and coalesces saves when the first write rejects: %s',
    async (rejectFirst) => {
      const harness = createColorSettingsHarness()
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})
      const previews: string[] = []
      let stopWatching = () => {}
      try {
        await waitFor(harness.actor, (snapshot) => snapshot.matches('idle'))
        const setting =
          harness.actor.getSnapshot().context.modeling.backfaceColor
        stopWatching = effect(() => {
          previews.push(setting.currentSignal.value)
        })
        previews.length = 0
        harness.setColor('#FF0000')
        harness.setColor('#00FF00')
        harness.setColor('#0000FF')

        expect(setting.current).toBe('#0000FF')
        expect(previews).toEqual(['#FF0000', '#00FF00', '#0000FF'])
        await vi.waitFor(() => expect(harness.writes).toHaveLength(1))
        expect(harness.writes[0].user).toBe('#FF0000')
        if (rejectFirst) harness.writes[0].fail()
        else harness.writes[0].finish()

        await vi.waitFor(() => expect(harness.writes).toHaveLength(2))
        expect(harness.writes[1].user).toBe('#0000FF')
        expect(setting.current).toBe('#0000FF')
        expect(previews).toEqual(['#FF0000', '#00FF00', '#0000FF'])
        harness.writes[1].finish()
        await waitFor(harness.actor, (snapshot) => snapshot.matches('idle'))
        expect(harness.actor.getSnapshot().context.deferredEvents).toEqual([])
        expect(harness.maximumActiveWrites()).toBe(1)
        expect(consoleError).toHaveBeenCalledTimes(rejectFirst ? 1 : 0)
      } finally {
        stopWatching()
        harness.stop()
      }
    }
  )

  it('keeps the latest preview across a reload triggered by the active write', async () => {
    const harness = createColorSettingsHarness()
    const previews: string[] = []
    const subscription = harness.actor.subscribe((snapshot) => {
      previews.push(snapshot.context.modeling.backfaceColor.current)
    })
    try {
      await waitFor(harness.actor, (snapshot) => snapshot.matches('idle'))
      harness.setColor('#FF0000')
      await vi.waitFor(() => expect(harness.writes).toHaveLength(1))
      harness.actor.send({ type: 'reload.settings' })
      harness.setColor('#00FF00')
      harness.setColor('#0000FF')
      expect(
        harness.actor.getSnapshot().context.modeling.backfaceColor.current
      ).toBe('#0000FF')
      previews.length = 0
      harness.writes[0].finish()
      await waitFor(harness.actor, (snapshot) =>
        snapshot.matches('reloadingSettings')
      )
      harness.setColor('#FFFFFF')
      expect(
        harness.actor.getSnapshot().context.modeling.backfaceColor.current
      ).toBe('#FFFFFF')
      previews.length = 0

      const diskSettings = createSettings()
      diskSettings.modeling.backfaceColor.user = '#FF0000'
      harness.finishReload(diskSettings)
      await vi.waitFor(() => expect(harness.writes).toHaveLength(2))
      expect(harness.writes[1].user).toBe('#FFFFFF')
      expect(previews).toContain('#FFFFFF')
      expect(previews.every((color) => color === '#FFFFFF')).toBe(true)
      harness.writes[1].finish()
      await waitFor(harness.actor, (snapshot) => snapshot.matches('idle'))
      expect(harness.maximumActiveWrites()).toBe(1)
    } finally {
      subscription.unsubscribe()
      harness.stop()
    }
  })

  it('does not persist a later preview marked doNotPersist', async () => {
    const harness = createColorSettingsHarness()
    try {
      await waitFor(harness.actor, (snapshot) => snapshot.matches('idle'))
      harness.setColor('#FF0000')
      harness.setColor('#00FF00')
      harness.setColor('#0000FF', 'user', true)
      expect(
        harness.actor.getSnapshot().context.modeling.backfaceColor.current
      ).toBe('#0000FF')
      await vi.waitFor(() => expect(harness.writes).toHaveLength(1))
      expect(harness.writes[0].user).toBe('#FF0000')
      harness.writes[0].finish()
      await vi.waitFor(() => expect(harness.writes).toHaveLength(2))
      expect(harness.writes[1].user).toBe('#00FF00')
      harness.writes[1].finish()
      await waitFor(harness.actor, (snapshot) => snapshot.matches('idle'))
      expect(harness.writes).toHaveLength(2)
      expect(
        harness.actor.getSnapshot().context.modeling.backfaceColor.current
      ).toBe('#0000FF')
    } finally {
      harness.stop()
    }
  })

  it.each([false, true])(
    'preserves reset ordering when the last color comes after reset: %s',
    async (colorAfterReset) => {
      const harness = createColorSettingsHarness()
      const previews: string[] = []
      let stopWatching = () => {}
      try {
        await waitFor(harness.actor, (snapshot) => snapshot.matches('idle'))
        const setting =
          harness.actor.getSnapshot().context.modeling.backfaceColor
        stopWatching = effect(() => {
          previews.push(setting.currentSignal.value)
        })
        harness.setColor('#FF0000')
        if (colorAfterReset)
          harness.actor.send({ type: 'Reset settings', level: 'user' })
        harness.setColor('#0000FF', 'user', true)
        if (!colorAfterReset)
          harness.actor.send({ type: 'Reset settings', level: 'user' })
        previews.length = 0
        await vi.waitFor(() => expect(harness.writes).toHaveLength(1))
        harness.writes[0].finish()
        await vi.waitFor(() => expect(harness.writes).toHaveLength(2))
        expect(harness.writes[1].user).toBeUndefined()
        harness.writes[1].finish()
        await waitFor(harness.actor, (snapshot) => snapshot.matches('idle'))
        const expected = colorAfterReset ? '#0000FF' : setting.default
        expect(setting.current).toBe(expected)
        expect(previews.every((color) => color === expected)).toBe(true)
        expect(harness.writes).toHaveLength(2)
      } finally {
        stopWatching()
        harness.stop()
      }
    }
  )

  const nextProject = {
    path: '/projects/second',
    name: 'second',
    metadata: null,
    children: [],
    kcl_file_count: 1,
    directory_count: 0,
    default_file: '/projects/second/main.kcl',
    readWriteAccess: true,
  }
  const boundaries: SettingsMachineEvent[] = [
    { type: 'clear.project' },
    { type: 'load.project', project: nextProject },
  ]
  it.each(boundaries)(
    'preserves color save ownership across $type',
    async (boundary) => {
      const harness = createColorSettingsHarness()
      try {
        await waitFor(harness.actor, (snapshot) => snapshot.matches('idle'))
        harness.setColor('#FF0000', 'project')
        harness.setColor('#00FF00', 'project')
        harness.actor.send(boundary)
        harness.setColor(
          '#0000FF',
          boundary.type === 'load.project' ? 'project' : 'user'
        )
        await vi.waitFor(() => expect(harness.writes).toHaveLength(1))
        expect(harness.writes[0]).toMatchObject({
          project: '#FF0000',
          path: '/projects/first',
        })
        harness.writes[0].finish()
        await vi.waitFor(() => expect(harness.writes).toHaveLength(2))
        expect(harness.writes[1]).toMatchObject({
          project: '#00FF00',
          path: '/projects/first',
        })
        harness.writes[1].finish()
        await vi.waitFor(() => expect(harness.writes).toHaveLength(3))
        expect(harness.writes[2]).toMatchObject(
          boundary.type === 'load.project'
            ? { user: undefined, project: '#0000FF', path: nextProject.path }
            : { user: '#0000FF', project: undefined, path: undefined }
        )
        harness.writes[2].finish()
        await waitFor(harness.actor, (snapshot) => snapshot.matches('idle'))
        expect(harness.actor.getSnapshot().context.currentProject?.path).toBe(
          boundary.type === 'load.project' ? nextProject.path : undefined
        )
        expect(
          harness.actor.getSnapshot().context.modeling.backfaceColor.current
        ).toBe('#0000FF')
        expect(harness.maximumActiveWrites()).toBe(1)
      } finally {
        harness.stop()
      }
    }
  )
})

describe('settingsMachine', () => {
  it.each([
    ['retrocad', true],
    ['phosphor', true],
    ['retrocad', false],
    ['phosphor', false],
  ] as const)(
    'preserves the SSAO preference across %s style changes when initially %s',
    async (style, enabled) => {
      const initialSettings = createSettings()
      initialSettings.modeling.enableSSAO.user = enabled
      const wasmInstancePromise = Promise.resolve({} as ModuleType)
      const commandBarActor = createActor(commandBarMachine, {
        input: {
          commands: [],
          wasmInstancePromise,
          machineManager: {} as MachineManager,
        },
      }).start()
      const persisted: Array<{
        style: string
        ssao: boolean
        level?: string
      }> = []
      const actor = createActor(
        settingsMachine.provide({
          actors: {
            loadUserSettings: fromPromise(async () => initialSettings),
            persistSettings: fromPromise(async ({ input }) => {
              persisted.push({
                style: input.context.modeling.viewportRendering.current,
                ssao: input.context.modeling.enableSSAO.current,
                level: input.level,
              })
              return undefined
            }),
            registerCommands: fromCallback(() => () => {}),
            watchSystemTheme: fromCallback(() => () => {}),
          },
        }),
        {
          input: {
            ...initialSettings,
            commandBarActor,
            defaultProjectLibraries: [],
            projectLibrarySettingDefaultPolicies: [],
            extensionSettings: {},
            fileOperations: testFileOperations,
            wasmInstancePromise,
          },
        }
      ).start()
      try {
        await waitFor(actor, (snapshot) => snapshot.matches('idle'))
        actor.send({
          type: 'set.modeling.viewportRendering',
          data: { level: 'user', value: style },
        })
        await waitFor(actor, (snapshot) => snapshot.matches('idle'))
        expect(persisted.at(-1)).toEqual({
          style,
          ssao: enabled,
          level: 'user',
        })

        for (const local of [true, false]) {
          actor.send({
            type: 'set.modeling.useLocalRenderer',
            data: { level: 'user', value: local },
          })
          await waitFor(actor, (snapshot) => snapshot.matches('idle'))
          expect(persisted.at(-1)).toEqual({
            style,
            ssao: enabled,
            level: 'user',
          })
        }

        actor.send({
          type: 'set.modeling.enableSSAO',
          data: { level: 'user', value: !enabled },
        })
        await waitFor(actor, (snapshot) => snapshot.matches('idle'))
        expect(persisted.at(-1)).toEqual({
          style,
          ssao: !enabled,
          level: 'user',
        })
        actor.send({
          type: 'set.modeling.viewportRendering',
          data: { level: 'user', value: 'default' },
        })
        await waitFor(actor, (snapshot) => snapshot.matches('idle'))
        expect(persisted.at(-1)).toEqual({
          style: 'default',
          ssao: !enabled,
          level: 'user',
        })

        const restored = createSettings()
        restored.modeling.viewportRendering.user = style
        restored.modeling.enableSSAO.user = enabled
        actor.send({ type: 'Set all settings', settings: restored })
        expect(actor.getSnapshot().context.modeling.enableSSAO.current).toBe(
          enabled
        )
        expect(
          actor.getSnapshot().context.modeling.viewportRendering.current
        ).toBe(style)
      } finally {
        actor.stop()
        commandBarActor.stop()
      }
    }
  )

  it('updates the rendering style command when switching renderers', async () => {
    const initialSettings = createSettings()
    initialSettings.commandBar.includeSettings.user = true
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
          loadUserSettings: fromPromise(async () => initialSettings),
          persistSettings: fromPromise(async () => undefined),
          watchSystemTheme: fromCallback(() => () => {}),
        },
      }),
      {
        input: {
          ...initialSettings,
          commandBarActor,
          defaultProjectLibraries: [],
          projectLibrarySettingDefaultPolicies: [],
          extensionSettings: {},
          fileOperations: testFileOperations,
          wasmInstancePromise,
        },
      }
    ).start()
    const renderingCommand = () =>
      commandBarActor
        .getSnapshot()
        .context.commands.find(
          (command) => command.name === 'modeling.viewportRendering'
        )

    try {
      await waitFor(actor, (snapshot) => snapshot.matches('idle'))
      expect(renderingCommand()?.displayName).toBe(
        'Settings · modeling · Rendering style'
      )

      for (const local of [true, false, true]) {
        actor.send({
          type: 'set.modeling.useLocalRenderer',
          data: { level: 'user', value: local },
        })
        await waitFor(actor, (snapshot) => snapshot.matches('idle'))
        expect(renderingCommand() !== undefined).toBe(!local)
      }
    } finally {
      actor.stop()
      commandBarActor.stop()
    }
  })

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
      backfaceColorToPersist: { user: undefined, project: undefined },
      pendingBackfaceColors: {},
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
