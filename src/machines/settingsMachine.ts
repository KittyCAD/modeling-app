import {
  AnyActorRef,
  assign,
  enqueueActions,
  EventObject,
  fromCallback,
  fromPromise,
  sendTo,
  setup,
} from 'xstate'
import {
  Themes,
  darkModeMatcher,
  getOppositeTheme,
  getSystemTheme,
  setThemeClass,
} from 'lib/theme'
import {
  createSettings,
  settings,
  SettingsType,
} from 'lib/settings/initialSettings'
import {
  BaseUnit,
  SetEventTypes,
  SettingsLevel,
  SettingsPaths,
  WildcardSetEvent,
} from 'lib/settings/settingsTypes'
import {
  clearSettingsAtLevel,
  configurationToSettingsPayload,
  loadAndValidateSettings,
  projectConfigurationToSettingsPayload,
  saveSettings,
  setSettingsAtLevel,
} from 'lib/settings/settingsUtils'
import { NamedView } from 'wasm-lib/kcl/bindings/NamedView'
import {
  codeManager,
  engineCommandManager,
  kclManager,
  sceneEntitiesManager,
  sceneInfra,
} from 'lib/singletons'
import toast from 'react-hot-toast'
import decamelize from 'decamelize'
import { reportRejection } from 'lib/trap'
import { Project } from 'lib/project'
import {
  createSettingsCommand,
  settingsWithCommandConfigs,
} from 'lib/commandBarConfigs/settingsCommandConfig'
import { Command } from 'lib/commandTypes'
import { commandBarActor } from './commandBarMachine'

type SettingsMachineContext = SettingsType & {
  currentProject?: Project
}

export const settingsMachine = setup({
  types: {
    context: {} as SettingsMachineContext,
    input: {} as SettingsMachineContext,
    events: {} as (
      | WildcardSetEvent<SettingsPaths>
      | SetEventTypes
      | {
          type: 'set.app.theme'
          data: { level: SettingsLevel; value: Themes }
        }
      | {
          type: 'set.modeling.units'
          data: { level: SettingsLevel; value: BaseUnit }
        }
      | {
          type: 'Reset settings'
          level: SettingsLevel
        }
      | { type: 'Set all settings'; settings: typeof settings }
      | { type: 'set.modeling.namedViews'; value: NamedView }
      | { type: 'load.project'; project?: Project }
      | { type: 'clear.project' }
    ) & { doNotPersist?: boolean },
  },
  actors: {
    persistSettings: fromPromise<
      void,
      { doNotPersist: boolean; context: SettingsMachineContext }
    >(async ({ input }) => {
      // Without this, when a user changes the file, it'd
      // create a detection loop with the file-system watcher.
      if (input.doNotPersist) return

      codeManager.writeCausedByAppCheckedInFileTreeFileSystemWatcher = true
      const { currentProject, ...settings } = input.context

      return saveSettings(settings, currentProject?.path)
    }),
    loadUserSettings: fromPromise<SettingsMachineContext, void>(async () => {
      const { settings } = await loadAndValidateSettings()
      return settings
    }),
    loadProjectSettings: fromPromise<
      SettingsMachineContext,
      { project?: Project }
    >(async ({ input }) => {
      const { settings } = await loadAndValidateSettings(input.project?.path)
      return settings
    }),
    watchSystemTheme: fromCallback<{
      type: 'update.themeWatcher'
      theme: Themes
    }>(({ receive }) => {
      const listener = (e: MediaQueryListEvent) => {
        setThemeClass(e.matches ? Themes.Dark : Themes.Light)
      }

      receive((event) => {
        if (event.type !== 'update.themeWatcher') {
          return
        } else {
          if (event.theme === Themes.System) {
            darkModeMatcher?.addEventListener('change', listener)
          } else {
            darkModeMatcher?.removeEventListener('change', listener)
          }
        }
      })

      return () => darkModeMatcher?.removeEventListener('change', listener)
    }),
    registerCommands: fromCallback<
      { type: 'update' },
      { settings: SettingsType; actor: AnyActorRef }
    >(({ input, receive }) => {
      // If the user wants to hide the settings commands
      //from the command bar don't add them.
      if (settings.commandBar.includeSettings.current === false) return
      let commands: Command[] = []

      const updateCommands = () =>
        settingsWithCommandConfigs(input.settings)
          .map((type) =>
            createSettingsCommand({
              type,
              actor: input.actor,
            })
          )
          .filter((c) => c !== null) as Command[]
      const addCommands = () =>
        commandBarActor.send({
          type: 'Add commands',
          data: { commands: commands },
        })

      const removeCommands = () =>
        commandBarActor.send({
          type: 'Remove commands',
          data: { commands: commands },
        })

      receive((event) => {
        if (event.type !== 'update') return
        removeCommands()
        commands = updateCommands()
        addCommands()
      })

      commands = updateCommands()
      addCommands()

      return () => {
        removeCommands()
      }
    }),
  },
  actions: {
    setClientSideSceneUnits: ({ context, event }) => {
      const newBaseUnit =
        event.type === 'set.modeling.defaultUnit'
          ? (event.data.value as BaseUnit)
          : context.modeling.defaultUnit.current
      if (!sceneInfra) return
      sceneInfra.baseUnit = newBaseUnit
    },
    setEngineTheme: ({ context }) => {
      if (engineCommandManager && context.app.theme.current) {
        engineCommandManager
          .setTheme(context.app.theme.current)
          .catch(reportRejection)
      }
    },
    setClientTheme: ({ context }) => {
      if (!sceneInfra || !sceneEntitiesManager) return
      const opposingTheme = getOppositeTheme(context.app.theme.current)
      sceneInfra.theme = opposingTheme
      sceneEntitiesManager.updateSegmentBaseColor(opposingTheme)
    },
    setAllowOrbitInSketchMode: ({ context }) => {
      if (!sceneInfra.camControls) return
      sceneInfra.camControls._setting_allowOrbitInSketchMode =
        context.app.allowOrbitInSketchMode.current
      // ModelingMachineProvider will do a use effect to trigger the camera engine sync
    },
    toastSuccess: ({ event }) => {
      if (!('data' in event)) return
      const eventParts = event.type.replace(/^set./, '').split('.') as [
        keyof typeof settings,
        string
      ]
      const truncatedNewValue = event.data.value?.toString().slice(0, 28)
      const message =
        `Set ${decamelize(eventParts[1], { separator: ' ' })}` +
        (truncatedNewValue
          ? ` to "${truncatedNewValue}${
              truncatedNewValue.length === 28 ? '...' : ''
            }"${
              event.data.level === 'project'
                ? ' for this project'
                : ' as a user default'
            }`
          : '')
      toast.success(message, {
        duration: message.split(' ').length * 100 + 1500,
        id: `${event.type}.success`,
      })
    },
    'Execute AST': ({ context, event }) => {
      try {
        const relevantSetting = (s: typeof settings) => {
          return (
            s.modeling?.defaultUnit?.current !==
              context.modeling.defaultUnit.current ||
            s.modeling.showScaleGrid.current !==
              context.modeling.showScaleGrid.current ||
            s.modeling?.highlightEdges.current !==
              context.modeling.highlightEdges.current
          )
        }

        const allSettingsIncludesUnitChange =
          event.type === 'Set all settings' &&
          relevantSetting(event.settings || context)
        const resetSettingsIncludesUnitChange =
          event.type === 'Reset settings' && relevantSetting(settings)

        const shouldExecute =
          kclManager !== undefined &&
          (event.type === 'set.modeling.defaultUnit' ||
            event.type === 'set.modeling.showScaleGrid' ||
            event.type === 'set.modeling.highlightEdges' ||
            allSettingsIncludesUnitChange ||
            resetSettingsIncludesUnitChange)

        if (shouldExecute) {
          // Unit changes requires a re-exec of code
          kclManager.executeCode(true).catch(reportRejection)
        } else {
          // For any future logging we'd like to do
          // console.log(
          //   'Not re-executing AST because the settings change did not affect the code interpretation'
          // )
        }
      } catch (e) {
        console.error('Error executing AST after settings change', e)
      }
    },
    setThemeColor: ({ context }) => {
      document.documentElement.style.setProperty(
        `--primary-hue`,
        context.app.themeColor.current
      )
    },
    /**
     * Update the --cursor-color CSS variable
     * based on the setting textEditor.blinkingCursor.current
     */
    setCursorColor: ({ context }) => {
      document.documentElement.style.setProperty(
        `--cursor-color`,
        context.textEditor.blinkingCursor.current ? 'auto' : 'transparent'
      )
    },
    /** Unload the project-level setting values from memory */
    clearProjectSettings: assign(({ context }) => {
      // Peel off all non-settings context
      const { currentProject: _, ...settings } = context
      const newSettings = clearSettingsAtLevel(settings, 'project')
      return newSettings
    }),
    /** Unload the current project's info from memory */
    clearCurrentProject: assign(({ context }) => {
      return { ...context, currentProject: undefined }
    }),
    resetSettings: assign(({ context, event }) => {
      if (!('level' in event)) return {}

      // Create a new, blank payload
      const newPayload =
        event.level === 'user'
          ? configurationToSettingsPayload({})
          : projectConfigurationToSettingsPayload({})

      // Reset the settings at that level
      const newSettings = setSettingsAtLevel(context, event.level, newPayload)

      return newSettings
    }),
    setAllSettings: assign(({ event, context }) => {
      if ('settings' in event) return event.settings
      else if ('output' in event) return event.output || context
      else return context
    }),
    setSettingAtLevel: assign(({ context, event }) => {
      if (!('data' in event)) return {}
      const { level, value } = event.data
      const [category, setting] = event.type
        .replace(/^set./, '')
        .split('.') as [keyof typeof settings, string]

      // @ts-ignore
      context[category][setting][level] = value

      console.log('SETTING NEW VALUE!', value)

      const newContext = {
        ...context,
        [category]: {
          ...context[category],
          // @ts-ignore
          [setting]: context[category][setting],
        },
      }

      console.log('NEW CONTEXT!', newContext)

      return newContext
    }),
    setThemeClass: ({ context }) => {
      const currentTheme = context.app.theme.current ?? Themes.System
      setThemeClass(
        currentTheme === Themes.System ? getSystemTheme() : currentTheme
      )
    },
    setEngineCameraProjection: ({ context }) => {
      const newCurrentProjection = context.modeling.cameraProjection.current
      sceneInfra.camControls.setEngineCameraProjection(newCurrentProjection)
    },
    sendThemeToWatcher: sendTo('watchSystemTheme', ({ context }) => ({
      type: 'update.themeWatcher',
      theme: context.app.theme.current,
    })),
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QGUwBc0EsB2VYDpMIAbMAYlnXwEMAHW-Ae2wCNHqAnCHKZNatAFdYAbQAMAXUShajWJizNpIAB6IAzAA4x+AIyaAbJoCsAFl1njAJmOaANCACeiXQHZ1+a7bdWDATnUxawBfYIdUDB4CIlIKKjoGNAALMABbMABhRmJGDnEpJBBZeUVsZTUELR19IzMLUy97J0RfTXxDBr8DAxtdMSs-UPD0LFxoknJKNHxUxggwYh58eYAzakFiNABVbAV85WKFTCVCiqq9QxNzSxsm50qDU3wrMXV1V2M-bT8xV6GQCKjPCECZxaYJfDJNJgfaFQ6lcoabQXWrXBq3Bz3YzqPz4AyvL7qYw1TS6Az-QFREGxKY0ej4WBoDhgaipACSEwAsnMYZIDnIjidQGdkSS6jdbJjEK5zHi-PouqYiQZjBSRlSYpN4vTqMQcgB3ADyHBYCjZ2GQAGt0ABjJLc+awmQChGnJHVS7i9GS5oIQweVxueVWVz4mW6NWRMbUrXTWbzRa4fA21lgDjUAAKHEYACswDbSk6ii7jmU3ZVRZ60Y0pQg+rorPglQ2rKZ-FY3DLI0DxjSqPGFkskpgoElFqO0ABRaBwIvw0uIise1H1Gu+3Rk3R6Uydaz47qqsIA9XRzVkABKcHQAAIpj25yWhap3SirquMevAriTK4urYBhYViaN2GqghE166sQt4nngD4lAu5Zkni1yaKG2i6OoBgblYtY7sYniGNYmjqKYmjyropggaeoK0gOiZQAySSMPqyApqQADiHBEHBgplsKL5itWH73BYKr4OoLzmBhHahlRwJnjk1AQPgtDZnmBY8a6-EIKYVgePopEfKRmhAQ2xi1m8FyuCGnxmHhJFyb25AAFSaQh2nnIJ74+iJgZPK87ykmR-SmK4wFHpS0a0Gm8iMjw0FRngZAQMwYCENgABujDWvgkXAtFHCxUCCU9ggOBZSmhaSG5T4VKFuIkUEO7uPKfihaYtb6JZQR+J8Sq-iR4XDIlBAFUV8V3lEZBptmHAqcQAgrLkqS5TBo0xZgcW4CVURlZljCVaW+Q1Xxz46ciRhiFhBjvEEPmIKSVk2b1O4NA5EVrfgincLgWyUBwyWpelWU5XlBDfTwf1pntFUCEd1V8nCj6nWczyfPiYgfL4xhhZoqGdR8OhXT0xJiL1HxaI5X3sD9UBQwDM25PNi3LatI3U0pkP-TDB1w8wx2I868G1RomEEURGHWZjrydV0Hjym2bw3bY2LqFTEO4Fmub5mggPYGl5XZWlYMc7TWvqWgPOHfzCMFELvGLn035dGIPgYW1ui9bLv7PK8LxGGRFG6erNM8ObOvTRws3M2gS0cCtJsa1A4cFlbfPYALdvFsLKMaMS+BiKYfg2NigZk+85m+h2pg6L+MpthhKtEqER7YDy8CFGD-I54uAC06ie88ZL4i8FFfmSta92YBe-L8fhhaGLyYVTmrdw75ahbWqEGPgfjyj+PR762EYfezY2bcVk1jGvWlnWRTxB8YWEysY6O6Fve94vUB5fDXxIh5zX6-0b7uTOr3EMW4OzdH6K7JUZMJ7rh3I2X+PRpZvE+K4ABZs1I6xASLBAYhawdj6M8CSG4F64zVi3IAA */
  initial: 'loadingUser',
  context: ({ input }) => {
    return {
      ...createSettings(),
      ...input,
    }
  },
  invoke: [
    {
      src: 'watchSystemTheme',
      id: 'watchSystemTheme',
    },
    {
      src: 'registerCommands',
      id: 'registerCommands',
      // Peel off the non-settings context
      input: ({ context: { currentProject, ...settings }, self }) => ({
        settings,
        actor: self,
      }),
    },
  ],
  states: {
    idle: {
      entry: ['setThemeClass', 'setClientSideSceneUnits', 'sendThemeToWatcher'],

      on: {
        '*': {
          target: 'persisting settings',
          actions: [
            'setSettingAtLevel',
            'toastSuccess',
            enqueueActions(({ enqueue, check }) => {
              if (
                check(
                  ({ event }) => event.type === 'set.textEditor.blinkingCursor'
                )
              ) {
                enqueue('setCursorColor')
              }
            }),
          ],
        },

        'set.modeling.namedViews': {
          target: 'persisting settings',

          actions: ['setSettingAtLevel'],
        },

        'set.app.onboardingStatus': {
          target: 'persisting settings',

          // No toast
          actions: ['setSettingAtLevel'],
        },

        'set.app.themeColor': {
          target: 'persisting settings',

          // No toast
          actions: ['setSettingAtLevel', 'setThemeColor'],
        },

        'set.modeling.defaultUnit': {
          target: 'persisting settings',

          actions: [
            'setSettingAtLevel',
            'toastSuccess',
            'setClientSideSceneUnits',
            'Execute AST',
          ],
        },

        'set.app.theme': {
          target: 'persisting settings',

          actions: [
            'setSettingAtLevel',
            'toastSuccess',
            'setThemeClass',
            'setEngineTheme',
            'setClientTheme',
            'sendThemeToWatcher',
          ],
        },

        'set.app.streamIdleMode': {
          target: 'persisting settings',

          actions: ['setSettingAtLevel', 'toastSuccess'],
        },

        'set.app.allowOrbitInSketchMode': {
          target: 'persisting settings',
          actions: [
            'setSettingAtLevel',
            'toastSuccess',
            'setAllowOrbitInSketchMode',
          ],
        },

        'set.modeling.cameraProjection': {
          target: 'persisting settings',

          actions: [
            'setSettingAtLevel',
            'toastSuccess',
            'setEngineCameraProjection',
          ],
        },

        'set.modeling.highlightEdges': {
          target: 'persisting settings',

          actions: ['setSettingAtLevel', 'toastSuccess', 'Execute AST'],
        },

        'Reset settings': {
          target: 'persisting settings',

          actions: [
            'resetSettings',
            'setThemeClass',
            'setEngineTheme',
            'setClientSideSceneUnits',
            'setThemeColor',
            'Execute AST',
            'setClientTheme',
            'setAllowOrbitInSketchMode',
            'sendThemeToWatcher',
          ],
        },

        'Set all settings': {
          actions: [
            'setAllSettings',
            'setThemeClass',
            'setEngineTheme',
            'setClientSideSceneUnits',
            'setThemeColor',
            'Execute AST',
            'setClientTheme',
            'setAllowOrbitInSketchMode',
            'sendThemeToWatcher',
          ],
        },

        'set.modeling.showScaleGrid': {
          target: 'persisting settings',
          actions: ['setSettingAtLevel', 'toastSuccess', 'Execute AST'],
        },

        'load.project': {
          target: 'loadingProject',
        },

        'clear.project': {
          target: 'idle',
          reenter: true,
          actions: [
            'clearProjectSettings',
            'clearCurrentProject',
            'setThemeColor',
            sendTo('registerCommands', { type: 'update' }),
          ],
        },
      },
    },

    'persisting settings': {
      invoke: {
        src: 'persistSettings',
        onDone: {
          target: 'idle',
        },
        onError: {
          target: 'idle',
          actions: () => {
            console.error('Error persisting settings')
          },
        },
        input: ({ context, event }) => {
          return {
            doNotPersist: event.doNotPersist ?? false,
            context,
          }
        },
      },
    },

    loadingUser: {
      invoke: {
        src: 'loadUserSettings',
        onDone: {
          target: 'idle',
          actions: [
            'setAllSettings',
            'setThemeClass',
            'setEngineTheme',
            'setClientSideSceneUnits',
            'setThemeColor',
            'setClientTheme',
            'setAllowOrbitInSketchMode',
            'sendThemeToWatcher',
          ],
        },
        onError: {
          target: 'idle',
          actions: ({ event }) => {
            console.error('Error loading user settings', event)
          },
        },
      },
    },
    loadingProject: {
      entry: [
        assign({
          currentProject: ({ event }) =>
            event.type === 'load.project' ? event.project : undefined,
        }),
      ],
      invoke: {
        src: 'loadProjectSettings',
        onDone: {
          target: 'idle',
          actions: [
            'setAllSettings',
            'setThemeClass',
            'setEngineTheme',
            'setClientSideSceneUnits',
            'setThemeColor',
            'Execute AST',
            'setClientTheme',
            'setAllowOrbitInSketchMode',
            'sendThemeToWatcher',
            sendTo('registerCommands', { type: 'update' }),
          ],
        },
        onError: 'idle',
        input: ({ event }) => {
          return {
            project: event.type === 'load.project' ? event.project : undefined,
          }
        },
      },
    },
  },
})
