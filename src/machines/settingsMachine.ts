import decamelize from 'decamelize'
import toast from 'react-hot-toast'
import type { ActorRefFrom, AnyActorRef } from 'xstate'
import {
  assign,
  enqueueActions,
  fromCallback,
  fromPromise,
  sendTo,
  setup,
} from 'xstate'

import type { NamedView } from '@rust/kcl-lib/bindings/NamedView'

import {
  createSettingsCommand,
  settingsWithCommandConfigs,
} from '@src/lib/commandBarConfigs/settingsCommandConfig'
import type { Command } from '@src/lib/commandTypes'
import type { Project } from '@src/lib/project'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { createSettings } from '@src/lib/settings/initialSettings'
import type {
  BaseUnit,
  SetEventTypes,
  SettingsLevel,
  SettingsPaths,
  WildcardSetEvent,
} from '@src/lib/settings/settingsTypes'
import {
  clearSettingsAtLevel,
  configurationToSettingsPayload,
  loadAndValidateSettings,
  projectConfigurationToSettingsPayload,
  setSettingsAtLevel,
} from '@src/lib/settings/settingsUtils'
import {
  Themes,
  darkModeMatcher,
  getSystemTheme,
  setThemeClass,
} from '@src/lib/theme'
import { ACTOR_IDS } from '@src/machines/machineConstants'
import type { KclManager } from '@src/lang/KclManager'

export type SettingsActorDepsType = {
  currentProject?: Project
  kclManager: KclManager
}
export type SettingsMachineContext = SettingsType & SettingsActorDepsType

export type SettingsActorType = ActorRefFrom<typeof settingsMachine>

export const settingsMachine = setup({
  types: {
    context: {} as SettingsMachineContext,
    input: {} as SettingsMachineContext,
    events: {} as (
      | WildcardSetEvent<SettingsPaths>
      | SetEventTypes
      | {
          type: 'set.modeling.units'
          data: { level: SettingsLevel; value: BaseUnit }
        }
      | {
          type: 'Reset settings'
          level: SettingsLevel
        }
      | {
          type: 'Set all settings'
          settings: SettingsType
        }
      | {
          type: 'set.app.namedViews'
          data: {
            value: NamedView
            toastCallback: () => void
            level: SettingsLevel
          }
        }
      | { type: 'load.project'; project?: Project }
      | { type: 'clear.project' }
    ) & { doNotPersist?: boolean },
  },
  actors: {
    persistSettings: fromPromise<
      undefined,
      {
        doNotPersist: boolean
        context: SettingsMachineContext
        toastCallback?: () => void
      }
    >(async () => {
      // Implementation moved to singletons.ts to provide necessary singletons.
    }),
    loadUserSettings: fromPromise<SettingsType, { kclManager: KclManager }>(
      async ({ input }) => {
        const { settings } = await loadAndValidateSettings(
          input.kclManager.wasmInstancePromise
        )
        return settings
      }
    ),
    loadProjectSettings: fromPromise<
      SettingsType,
      { project?: Project; kclManager: KclManager }
    >(async ({ input }) => {
      const { settings } = await loadAndValidateSettings(
        input.kclManager.wasmInstancePromise,
        input.project?.path
      )
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
      { type: 'update'; settings: SettingsType },
      { settings: SettingsType; actor: AnyActorRef }
    >(({ input, receive, system }) => {
      // This assumes this actor is running in a system with a command palette
      const commandBarActor = system.get(ACTOR_IDS.COMMAND_BAR)
      // If the user wants to hide the settings commands
      //from the command bar don't add them.
      if (input.settings.commandBar.includeSettings.current === false) {
        return
      }
      let commands: Command[] = []

      const updateCommands = (newSettings: SettingsType) =>
        settingsWithCommandConfigs(newSettings)
          .map((type) =>
            createSettingsCommand({
              type,
              actor: input.actor,
            })
          )
          .filter((c) => c !== null)
      if (commandBarActor === undefined) {
        console.warn(
          'Tried to register commands, but no command bar actor was found'
        )
      }
      const addCommands = () =>
        commandBarActor?.send({
          type: 'Add commands',
          data: { commands: commands },
        })

      const removeCommands = () =>
        commandBarActor?.send({
          type: 'Remove commands',
          data: { commands: commands },
        })

      receive(({ type, settings: newSettings }) => {
        if (type !== 'update') {
          return
        }
        removeCommands()
        commands =
          newSettings.commandBar.includeSettings.current === false
            ? []
            : updateCommands(newSettings)
        addCommands()
      })

      commands = updateCommands(input.settings)
      addCommands()

      return () => {
        removeCommands()
      }
    }),
  },
  actions: {
    setEngineTheme: () => {
      // Implementation moved to singletons.ts to provide necessary singletons.
    },
    setClientTheme: () => {
      // Implementation moved to singletons.ts to provide necessary singletons.
    },
    setAllowOrbitInSketchMode: () => {
      // Implementation moved to singletons.ts to provide necessary singletons.
    },
    toastSuccess: ({ event }) => {
      if (!('data' in event)) {
        return
      }
      const eventParts = event.type.replace(/^set./, '').split('.') as [
        keyof SettingsType,
        string,
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
    'Execute AST': () => {
      // Implementation moved to singletons.ts to provide necessary singletons.
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
      const currentSettings = getOnlySettingsFromContext(context)
      const newSettings = clearSettingsAtLevel(currentSettings, 'project')
      return newSettings
    }),
    /** Unload the current project's info from memory */
    clearCurrentProject: assign(({ context }) => {
      return { ...context, currentProject: undefined }
    }),
    resetSettings: assign(({ context, event }) => {
      if (!('level' in event)) return {}

      console.log('Resetting settings at level', event.level)

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
        .split('.') as [keyof SettingsType, string]

      // @ts-ignore
      context[category][setting][level] = value

      const newContext = {
        ...context,
        [category]: {
          ...context[category],
          // @ts-ignore
          [setting]: context[category][setting],
        },
      }

      return newContext
    }),
    setThemeClass: ({ context }) => {
      const currentTheme = context.app.theme.current ?? Themes.System
      setThemeClass(
        currentTheme === Themes.System ? getSystemTheme() : currentTheme
      )
    },
    setEngineCameraProjection: () => {
      // Implementation moved to singletons.ts to provide necessary singletons.
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
      input: ({ context, self }) => ({
        settings: getOnlySettingsFromContext(context),
        actor: self,
      }),
    },
  ],
  states: {
    idle: {
      entry: ['setThemeClass', 'sendThemeToWatcher'],

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

        'set.app.namedViews': {
          target: 'persisting settings',

          actions: ['setSettingAtLevel'],
        },

        'set.app.onboardingStatus': {
          target: 'persisting settings',

          // No toast
          actions: ['setSettingAtLevel'],
        },

        'set.commandBar.includeSettings': {
          target: 'persisting settings',

          actions: [
            'setSettingAtLevel',
            'toastSuccess',
            sendTo('registerCommands', ({ context }) => ({
              type: 'update',
              settings: getOnlySettingsFromContext(context),
            })),
          ],
        },

        'set.modeling.defaultUnit': {
          target: 'persisting settings',

          actions: ['setSettingAtLevel', 'toastSuccess', 'Execute AST'],
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
            'Execute AST',
            'setClientTheme',
            'setAllowOrbitInSketchMode',
            'sendThemeToWatcher',
            sendTo('registerCommands', ({ context }) => ({
              type: 'update',
              settings: getOnlySettingsFromContext(context),
            })),
          ],
        },

        'Set all settings': {
          actions: [
            'setAllSettings',
            'setThemeClass',
            'setEngineTheme',
            'Execute AST',
            'setClientTheme',
            'setAllowOrbitInSketchMode',
            'sendThemeToWatcher',
            sendTo('registerCommands', ({ context }) => ({
              type: 'update',
              settings: getOnlySettingsFromContext(context),
            })),
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
            sendTo('registerCommands', ({ context }) => ({
              type: 'update',
              settings: getOnlySettingsFromContext(context),
            })),
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
          if (
            event.type === 'set.app.namedViews' &&
            'toastCallback' in event.data
          ) {
            return {
              doNotPersist: event.doNotPersist ?? false,
              context,
              toastCallback: event.data.toastCallback,
            }
          }

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
        input: ({ context: { kclManager } }) => ({ kclManager }),
        onDone: {
          target: 'idle',
          actions: [
            'setAllSettings',
            'setThemeClass',
            'setEngineTheme',
            'setClientTheme',
            'setAllowOrbitInSketchMode',
            'sendThemeToWatcher',
            sendTo('registerCommands', ({ context }) => ({
              type: 'update',
              settings: getOnlySettingsFromContext(context),
            })),
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
            'Execute AST',
            'setClientTheme',
            'setAllowOrbitInSketchMode',
            'sendThemeToWatcher',
            sendTo('registerCommands', ({ context }) => ({
              type: 'update',
              settings: getOnlySettingsFromContext(context),
            })),
          ],
        },
        onError: 'idle',
        input: ({ event, context: { kclManager } }) => {
          return {
            kclManager,
            project: event.type === 'load.project' ? event.project : undefined,
          }
        },
      },
    },
  },
})

function getOnlySettingsFromContext(s: SettingsMachineContext): SettingsType {
  const { currentProject: _c, kclManager: _k, ...settings } = s
  return settings
}
