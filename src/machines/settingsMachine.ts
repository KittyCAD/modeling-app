import { assign, fromPromise, setup } from 'xstate'
import {
  Themes,
  getOppositeTheme,
  getSystemTheme,
  setThemeClass,
} from 'lib/theme'
import { createSettings, settings } from 'lib/settings/initialSettings'
import {
  BaseUnit,
  SetEventTypes,
  SettingsLevel,
  SettingsPaths,
  WildcardSetEvent,
} from 'lib/settings/settingsTypes'
import {
  configurationToSettingsPayload,
  projectConfigurationToSettingsPayload,
  saveSettings,
  setSettingsAtLevel,
} from 'lib/settings/settingsUtils'
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

type SettingsMachineContext = ReturnType<typeof createSettings>

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
    ) & { doNotPersist?: boolean },
  },
  actors: {
    persistSettings: fromPromise<void, { doNotPersist: boolean, context: SettingsMachineContext }>(async ({ input, self }) => {
      // Without this, when a user changes the file, it'd
      // create a detection loop with the file-system watcher.
      if (input.doNotPersist) return

      codeManager.writeCausedByAppCheckedInFileTreeFileSystemWatcher = true

      // If the machine is not spawned with an appMachine,
      // it will only persist user settings.
      const parentActor = self._parent?.getSnapshot()
      const currentProjectFromParent = parentActor?.context?.currentProject

      return saveSettings(input.context, currentProjectFromParent)
    }),
  },
  actions: {
    setClientSideSceneUnits: ({ context, event }) => {
      const newBaseUnit =
        event.type === 'set.modeling.defaultUnit'
          ? (event.data.value as BaseUnit)
          : context.modeling.defaultUnit.current
      sceneInfra.baseUnit = newBaseUnit
    },
    setEngineTheme: ({ context }) => {
      engineCommandManager
        .setTheme(context.app.theme.current)
        .catch(reportRejection)
    },
    setClientTheme: ({ context }) => {
      const opposingTheme = getOppositeTheme(context.app.theme.current)
      sceneInfra.theme = opposingTheme
      sceneEntitiesManager.updateSegmentBaseColor(opposingTheme)
    },
    setAllowOrbitInSketchMode: ({ context }) => {
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
          event.type === 'Set all settings' && relevantSetting(event.settings)
        const resetSettingsIncludesUnitChange =
          event.type === 'Reset settings' && relevantSetting(settings)

        if (
          event.type === 'set.modeling.defaultUnit' ||
          event.type === 'set.modeling.showScaleGrid' ||
          event.type === 'set.modeling.highlightEdges' ||
          allSettingsIncludesUnitChange ||
          resetSettingsIncludesUnitChange
        ) {
          // Unit changes requires a re-exec of code
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          kclManager.executeCode(true)
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
    setAllSettings: assign(({ event }) => {
      if (!('settings' in event)) return {}
      return event.settings
    }),
    setSettingAtLevel: assign(({ context, event }) => {
      if (!('data' in event)) return {}
      const { level, value } = event.data
      const [category, setting] = event.type
        .replace(/^set./, '')
        .split('.') as [keyof typeof settings, string]

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
    setEngineCameraProjection: ({ context }) => {
      const newCurrentProjection = context.modeling.cameraProjection.current
      sceneInfra.camControls.setEngineCameraProjection(newCurrentProjection)
    },
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QGUwBc0EsB2VYDpMIAbMAYlnXwEMAHW-Ae2wCNHqAnCHKZNatAFdYAbQAMAXUShajWJizNpIAB6IAzAA4x+AIyaAbJoCsAFl1njAJmOaANCACeiXQHZ1+a7bdWDATnUxawBfYIdUDB4CIlIKKjoGNAALMABbMABhRmJGDnEpJBBZeUVsZTUELR19IzMLUy97J0RfTXxDBr8DAxtdMSs-UPD0LFxoknJKNHxUxggwYh58eYAzakFiNABVbAV85WKFTCVCiqq9QxNzSxsm50qDU3wrMXV1V2M-bT8xV6GQCKjPCECZxaYJfDJNJgfaFQ6lcoabQXWrXBq3Bz3YzqPz4AyvL7qYw1TS6Az-QFREGxKY0ej4WBoDhgaipACSEwAsnMYZIDnIjidQGdkSS6jdbJjEK5zHi-PouqYiQZjBSRlSYpN4vTqMQcgB3ADyHBYCjZ2GQAGt0ABjJLc+awmQChGnJHVS7i9GS5oIQweVxueVWVz4mW6NWRMbUrXTWbzRa4fA21lgDjUAAKHEYACswDbSk6ii7jmU3ZVRZ60Y0pQg+rorPglQ2rKZ-FY3DLI0DxjSqPGFkskpgoElFqO0ABRaBwIvw0uIise1H1Gu+3Rk3R6Uydaz47qqsIA9XRzVkABKcHQAAIpj25yWhap3SirquMevAriTK4urYBhYViaN2GqghE166sQt4nngD4lAu5Zkni1yaKG2i6OoBgblYtY7sYniGNYmjqKYmjyropggaeoK0gOiZQAySSMPqyApqQADiHBEHBgplsKL5itWH73BYKr4OoLzmBhHahlRwJngAVDxrr8Uur5emuImBk8rzvKSZH9KYrjAUelLRrQabyIyPDQVGeBkBAzBgIQ2AAG6MNa+BmcCFkcFZQK2T2CA4O5KaFpIykIapRm4iRQQ7u48p+EZpi1vobz4EEfifEqv4kSZwx2QQvn+TZd5RGQabZhw+C0MQAgrLkqReTBxWWZg1m4IFUTBW5jBhaW+SRU+FSkToRhiFhBjvEEPr3KSFyuCGnxmHhJGhEe2A8vAhTeTtzrwSNiAALTqFuRKaOYVhnV802aPdtbHQYmW-L8xiuIGl1oTYcm9mA-KHXxz4IEZtaoc9fjyj+PSQ62Eama1tXtZ1UDdWMAO8YuZFPBRDRYTKxifFhYOQ3i9QHl8phBPDoRAA */
  id: 'Settings',
  initial: 'idle',
  context: ({ input }) => {
    return {
      ...createSettings(),
      ...input,
    }
  },
  states: {
    idle: {
      entry: ['setThemeClass', 'setClientSideSceneUnits'],

      on: {
        '*': {
          target: 'persisting settings',
          actions: ['setSettingAtLevel', 'toastSuccess'],
        },

        'set.app.onboardingStatus': {
          target: 'persisting settings',

          // No toast
          actions: ['setSettingAtLevel'],
        },

        'set.app.themeColor': {
          target: 'persisting settings',

          // No toast
          actions: ['setSettingAtLevel'],
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
            'Execute AST',
            'setClientTheme',
            'setAllowOrbitInSketchMode',
          ],
        },

        'Set all settings': {
          actions: [
            'setAllSettings',
            'setThemeClass',
            'setEngineTheme',
            'setClientSideSceneUnits',
            'Execute AST',
            'setClientTheme',
            'setAllowOrbitInSketchMode',
          ],
        },

        'set.modeling.showScaleGrid': {
          target: 'persisting settings',
          actions: ['setSettingAtLevel', 'toastSuccess', 'Execute AST'],
        },
      },
    },

    'persisting settings': {
      invoke: {
        src:'persistSettings',
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
      }
    }
  },
})
