import { trap } from 'lib/trap'
import { useMachine, useSelector } from '@xstate/react'
import { useNavigate, useRouteLoaderData, useLocation } from 'react-router-dom'
import { PATHS, BROWSER_PATH } from 'lib/paths'
import React, { createContext, useEffect, useState } from 'react'
import { settingsMachine } from 'machines/settingsMachine'
import { toast } from 'react-hot-toast'
import {
  darkModeMatcher,
  getOppositeTheme,
  setThemeClass,
  Themes,
} from 'lib/theme'
import decamelize from 'decamelize'
import { Actor, AnyStateMachine, ContextFrom, Prop, StateFrom } from 'xstate'
import {
  kclManager,
  sceneInfra,
  engineCommandManager,
  sceneEntitiesManager,
} from 'lib/singletons'
import { IndexLoaderData } from 'lib/types'
import { settings } from 'lib/settings/initialSettings'
import {
  createSettingsCommand,
  settingsWithCommandConfigs,
} from 'lib/commandBarConfigs/settingsCommandConfig'
import { Command } from 'lib/commandTypes'
import { BaseUnit } from 'lib/settings/settingsTypes'
import {
  saveSettings,
  loadAndValidateSettings,
} from 'lib/settings/settingsUtils'
import { reportRejection } from 'lib/trap'
import { getAppSettingsFilePath } from 'lib/desktop'
import { isDesktop } from 'lib/isDesktop'
import { useFileSystemWatcher } from 'hooks/useFileSystemWatcher'
import { codeManager } from 'lib/singletons'
import { createRouteCommands } from 'lib/commandBarConfigs/routeCommandConfig'
import { commandBarActor } from 'machines/commandBarMachine'

type MachineContext<T extends AnyStateMachine> = {
  state: StateFrom<T>
  context: ContextFrom<T>
  send: Prop<Actor<T>, 'send'>
}

type SettingsAuthContextType = {
  settings: MachineContext<typeof settingsMachine>
}

/**
 * This variable is used to store the last snapshot of the settings context
 * for use outside of React, such as in `wasm.ts`. It is updated every time
 * the settings machine changes with `useSelector`.
 * TODO: when we decouple XState from React, we can just subscribe to the actor directly from `wasm.ts`
 */
export let lastSettingsContextSnapshot:
  | ContextFrom<typeof settingsMachine>
  | undefined

export const SettingsAuthContext = createContext({} as SettingsAuthContextType)

export const SettingsAuthProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const loadedSettings = useRouteLoaderData(PATHS.INDEX) as typeof settings
  const loadedProject = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  return (
    <SettingsAuthProviderBase
      loadedSettings={loadedSettings}
      loadedProject={loadedProject}
    >
      {children}
    </SettingsAuthProviderBase>
  )
}

// For use in jest tests we don't want to use the loader data
// and mock the whole Router
export const SettingsAuthProviderJest = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const loadedSettings = settings
  return (
    <SettingsAuthProviderBase loadedSettings={loadedSettings}>
      {children}
    </SettingsAuthProviderBase>
  )
}

export const SettingsAuthProviderBase = ({
  children,
  loadedSettings,
  loadedProject,
}: {
  children: React.ReactNode
  loadedSettings: typeof settings
  loadedProject?: IndexLoaderData
}) => {
  const location = useLocation()
  const navigate = useNavigate()
  const [settingsPath, setSettingsPath] = useState<string | undefined>(
    undefined
  )

  const [settingsState, settingsSend, settingsActor] = useMachine(
    settingsMachine.provide({
      actions: {
        //TODO: batch all these and if that's difficult to do from tsx,
        // make it easy to do

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
              event.type === 'Set all settings' &&
              relevantSetting(event.settings)
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
        async persistSettings({ context, event }) {
          // Without this, when a user changes the file, it'd
          // create a detection loop with the file-system watcher.
          if (event.doNotPersist) return

          codeManager.writeCausedByAppCheckedInFileTreeFileSystemWatcher = true
          return saveSettings(context, loadedProject?.project?.path)
        },
      },
    }),
    { input: loadedSettings }
  )
  // Any time the actor changes, update the settings state for external use
  useSelector(settingsActor, (s) => {
    lastSettingsContextSnapshot = s.context
  })

  useEffect(() => {
    if (!isDesktop()) return
    getAppSettingsFilePath().then(setSettingsPath).catch(trap)
  }, [])

  useFileSystemWatcher(
    async (eventType: string) => {
      // If there is a projectPath but it no longer exists it means
      // it was exterally removed. If we let the code past this condition
      // execute it will recreate the directory due to code in
      // loadAndValidateSettings trying to recreate files. I do not
      // wish to change the behavior in case anything else uses it.
      // Go home.
      if (loadedProject?.project?.path) {
        if (!window.electron.exists(loadedProject?.project?.path)) {
          navigate(PATHS.HOME)
          return
        }
      }

      // Only reload if there are changes. Ignore everything else.
      if (eventType !== 'change') return

      const data = await loadAndValidateSettings(loadedProject?.project?.path)
      settingsSend({
        type: 'Set all settings',
        settings: data.settings,
        doNotPersist: true,
      })
    },
    [settingsPath, loadedProject?.project?.path].filter(
      (x: string | undefined) => x !== undefined
    )
  )

  // Add settings commands to the command bar
  // They're treated slightly differently than other commands
  // Because their state machine doesn't have a meaningful .nextEvents,
  // and they are configured statically in initialiSettings
  useEffect(() => {
    // If the user wants to hide the settings commands
    //from the command bar don't add them.
    if (settingsState.context.commandBar.includeSettings.current === false)
      return

    const commands = settingsWithCommandConfigs(settingsState.context)
      .map((type) =>
        createSettingsCommand({
          type,
          send: settingsSend,
          context: settingsState.context,
          actor: settingsActor,
          isProjectAvailable: loadedProject !== undefined,
        })
      )
      .filter((c) => c !== null) as Command[]

    commandBarActor.send({ type: 'Add commands', data: { commands: commands } })

    return () => {
      commandBarActor.send({
        type: 'Remove commands',
        data: { commands },
      })
    }
  }, [
    settingsState,
    settingsSend,
    settingsActor,
    commandBarActor.send,
    settingsWithCommandConfigs,
  ])

  // Due to the route provider, i've moved this to the SettingsAuthProvider instead of CommandBarProvider
  // This will register the commands to route to Telemetry, Home, and Settings.
  useEffect(() => {
    const filePath =
      PATHS.FILE +
      '/' +
      encodeURIComponent(loadedProject?.file?.path || BROWSER_PATH)
    const { RouteTelemetryCommand, RouteHomeCommand, RouteSettingsCommand } =
      createRouteCommands(navigate, location, filePath)
    commandBarActor.send({
      type: 'Remove commands',
      data: {
        commands: [
          RouteTelemetryCommand,
          RouteHomeCommand,
          RouteSettingsCommand,
        ],
      },
    })
    if (location.pathname === PATHS.HOME) {
      commandBarActor.send({
        type: 'Add commands',
        data: { commands: [RouteTelemetryCommand, RouteSettingsCommand] },
      })
    } else if (location.pathname.includes(PATHS.FILE)) {
      commandBarActor.send({
        type: 'Add commands',
        data: {
          commands: [
            RouteTelemetryCommand,
            RouteSettingsCommand,
            RouteHomeCommand,
          ],
        },
      })
    }
  }, [location])

  // Listen for changes to the system theme and update the app theme accordingly
  // This is only done if the theme setting is set to 'system'.
  // It can't be done in XState (in an invoked callback, for example)
  // because there doesn't seem to be a good way to listen to
  // events outside of the machine that also depend on the machine's context
  useEffect(() => {
    const listener = (e: MediaQueryListEvent) => {
      if (settingsState.context.app.theme.current !== 'system') return
      setThemeClass(e.matches ? Themes.Dark : Themes.Light)
    }

    darkModeMatcher?.addEventListener('change', listener)
    return () => darkModeMatcher?.removeEventListener('change', listener)
  }, [settingsState.context])

  /**
   * Update the --primary-hue CSS variable
   * to match the setting app.themeColor.current
   */
  useEffect(() => {
    document.documentElement.style.setProperty(
      `--primary-hue`,
      settingsState.context.app.themeColor.current
    )
  }, [settingsState.context.app.themeColor.current])

  /**
   * Update the --cursor-color CSS variable
   * based on the setting textEditor.blinkingCursor.current
   */
  useEffect(() => {
    document.documentElement.style.setProperty(
      `--cursor-color`,
      settingsState.context.textEditor.blinkingCursor.current
        ? 'auto'
        : 'transparent'
    )
  }, [settingsState.context.textEditor.blinkingCursor.current])

  return (
    <SettingsAuthContext.Provider
      value={{
        settings: {
          state: settingsState,
          context: settingsState.context,
          send: settingsSend,
        },
      }}
    >
      {children}
    </SettingsAuthContext.Provider>
  )
}

export default SettingsAuthProvider
