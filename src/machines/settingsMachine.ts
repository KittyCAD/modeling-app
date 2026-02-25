import decamelize from 'decamelize'
import toast from 'react-hot-toast'
import type { ActorRefFrom, AnyActorRef } from 'xstate'
import { assign, fromCallback, fromPromise, sendTo, setup } from 'xstate'

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
  RgbaColor,
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
  saveSettings,
  setSettingsAtLevel,
} from '@src/lib/settings/settingsUtils'
import {
  Themes,
  darkModeMatcher,
  getSystemTheme,
  setThemeClass,
} from '@src/lib/theme'
import { rgbaToHex } from '@src/lib/utils'
import type { commandBarMachine } from '@src/machines/commandBarMachine'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

export type SettingsActorDepsType = {
  currentProject?: Project
  commandBarActor: ActorRefFrom<typeof commandBarMachine>
  wasmInstancePromise: Promise<ModuleType>
}
export type SettingsMachineContext = SettingsType & SettingsActorDepsType

export type SettingsActorType = ActorRefFrom<typeof settingsMachine>

const formatSettingValueForToast = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value)
  }

  if (typeof value === 'object') {
    if (
      'r' in value &&
      'g' in value &&
      'b' in value &&
      'a' in value &&
      typeof value.r === 'number' &&
      typeof value.g === 'number' &&
      typeof value.b === 'number' &&
      typeof value.a === 'number'
    ) {
      const rgba = value as RgbaColor
      const hex = rgbaToHex(rgba).toUpperCase()
      return rgba.a === 1 ? hex : `${hex} (alpha ${rgba.a.toFixed(2)})`
    }

    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  return String(value)
}

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
    >(async ({ input }) => {
      // Without this, when a user changes the file, it'd
      // create a detection loop with the file-system watcher.
      if (input.doNotPersist) return

      const {
        currentProject,
        wasmInstancePromise,
        commandBarActor: _c,
        ...settings
      } = input.context

      await saveSettings(wasmInstancePromise, settings, currentProject?.path)

      if (input.toastCallback) {
        input.toastCallback()
      }
    }),
    loadUserSettings: fromPromise<
      SettingsType,
      { wasmInstancePromise: Promise<ModuleType> }
    >(async ({ input }) => {
      const { settings } = await loadAndValidateSettings(
        input.wasmInstancePromise
      )
      return settings
    }),
    loadProjectSettings: fromPromise<
      SettingsType,
      {
        project?: Project
        settings: SettingsType
        wasmInstancePromise: Promise<ModuleType>
      }
    >(async ({ input }) => {
      const { settings } = await loadAndValidateSettings(
        input.wasmInstancePromise,
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
      {
        type: 'update'
        settings: SettingsType
        commandBarActor: ActorRefFrom<typeof commandBarMachine>
      },
      {
        settings: SettingsType
        actor: AnyActorRef
        commandBarActor: ActorRefFrom<typeof commandBarMachine>
      }
    >(({ input, receive }) => {
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

      const addCommands = (actor: ActorRefFrom<typeof commandBarMachine>) =>
        actor.send({
          type: 'Add commands',
          data: { commands: commands },
        })

      const removeCommands = (actor: ActorRefFrom<typeof commandBarMachine>) =>
        actor.send({
          type: 'Remove commands',
          data: { commands: commands },
        })

      receive(({ type, settings: newSettings, commandBarActor }) => {
        if (type !== 'update') {
          return
        }
        removeCommands(commandBarActor)
        commands =
          newSettings.commandBar.includeSettings.current === false
            ? []
            : updateCommands(newSettings)
        addCommands(commandBarActor)
      })

      // Initial command registration
      // Note: Async hideOnPlatform values are already resolved in loadAndValidateSettings,
      // so we can just register commands synchronously here
      commands = updateCommands(input.settings)
      addCommands(input.commandBarActor)
    }),
  },
  actions: {
    toastSuccess: ({ event }) => {
      if (!('data' in event)) {
        return
      }
      const eventParts = event.type.replace(/^set./, '').split('.') as [
        keyof SettingsType,
        string,
      ]
      const formattedNewValue = formatSettingValueForToast(event.data.value)
      const truncatedNewValue = formattedNewValue?.slice(0, 28)
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
    setEngineHighlightEdges: () => {
      // Implementation moved to singletons.ts to provide necessary singletons.
    },
    setEngineBackfaceColor: () => {
      // Implementation moved to singletons.ts to provide necessary singletons.
    },
    setEngineBackfaceColorAndRebuildScene: () => {
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
        commandBarActor: context.commandBarActor,
      }),
    },
  ],
  states: {
    idle: {
      entry: ['setThemeClass', 'sendThemeToWatcher'],

      on: {
        '*': {
          target: 'persisting settings',
          actions: ['setSettingAtLevel', 'toastSuccess'],
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
              commandBarActor: context.commandBarActor,
            })),
          ],
        },

        'set.modeling.defaultUnit': {
          target: 'persisting settings',

          actions: ['setSettingAtLevel', 'toastSuccess'],
        },

        'set.app.theme': {
          target: 'persisting settings',

          actions: ['setSettingAtLevel', 'toastSuccess', 'sendThemeToWatcher'],
        },
        'set.textEditor.textWrapping': {
          target: 'persisting settings',

          actions: ['setSettingAtLevel'],
        },
        'set.textEditor.blinkingCursor': {
          target: 'persisting settings',

          actions: ['setSettingAtLevel'],
        },

        'set.app.streamIdleMode': {
          target: 'persisting settings',

          actions: ['setSettingAtLevel', 'toastSuccess'],
        },

        'set.app.allowOrbitInSketchMode': {
          target: 'persisting settings',
          actions: ['setSettingAtLevel', 'toastSuccess'],
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

          actions: [
            'setSettingAtLevel',
            'toastSuccess',
            'setEngineHighlightEdges',
          ],
        },

        'set.modeling.backfaceColor': {
          target: 'persisting settings',

          actions: [
            'setSettingAtLevel',
            'toastSuccess',
            'setEngineBackfaceColorAndRebuildScene',
          ],
        },

        'Reset settings': {
          target: 'persisting settings',

          actions: [
            'resetSettings',
            'sendThemeToWatcher',
            sendTo('registerCommands', ({ context }) => ({
              type: 'update',
              settings: getOnlySettingsFromContext(context),
              commandBarActor: context.commandBarActor,
            })),
          ],
        },

        'Set all settings': {
          actions: [
            'setAllSettings',
            'sendThemeToWatcher',
            sendTo('registerCommands', ({ context }) => ({
              type: 'update',
              settings: getOnlySettingsFromContext(context),
              commandBarActor: context.commandBarActor,
            })),
          ],
        },

        'set.modeling.showScaleGrid': {
          target: 'persisting settings',
          actions: ['setSettingAtLevel', 'toastSuccess'],
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
              commandBarActor: context.commandBarActor,
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
        input: ({ context }) => ({
          wasmInstancePromise: context.wasmInstancePromise,
        }),
        onDone: {
          target: 'idle',
          actions: [
            'setAllSettings',
            'sendThemeToWatcher',
            sendTo('registerCommands', ({ context }) => ({
              type: 'update',
              settings: getOnlySettingsFromContext(context),
              commandBarActor: context.commandBarActor,
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
            'sendThemeToWatcher',
            sendTo('registerCommands', ({ context }) => ({
              type: 'update',
              settings: getOnlySettingsFromContext(context),
              commandBarActor: context.commandBarActor,
            })),
          ],
        },
        onError: 'idle',
        input: ({ event, context }) => {
          return {
            settings: getOnlySettingsFromContext(context),
            project: event.type === 'load.project' ? event.project : undefined,
            wasmInstancePromise: context.wasmInstancePromise,
          }
        },
      },
    },
  },
})

export function getOnlySettingsFromContext(
  s: SettingsMachineContext
): SettingsType {
  const {
    currentProject: _c,
    commandBarActor: _cba,
    wasmInstancePromise: _w,
    ...settings
  } = s
  return settings
}
