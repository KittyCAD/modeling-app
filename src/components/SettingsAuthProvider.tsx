import { useMachine } from '@xstate/react'
import { useNavigate, useRouteLoaderData } from 'react-router-dom'
import { paths } from 'lib/paths'
import { authMachine, TOKEN_PERSIST_KEY } from '../machines/authMachine'
import withBaseUrl from '../lib/withBaseURL'
import React, { createContext, useEffect } from 'react'
import useStateMachineCommands from '../hooks/useStateMachineCommands'
import { settingsMachine } from 'machines/settingsMachine'
import { toast } from 'react-hot-toast'
import {
  getThemeColorForEngine,
  getOppositeTheme,
  setThemeClass,
  Themes,
} from 'lib/theme'
import decamelize from 'decamelize'
import {
  AnyStateMachine,
  ContextFrom,
  InterpreterFrom,
  Prop,
  StateFrom,
} from 'xstate'
import { isTauri } from 'lib/isTauri'
import { authCommandBarConfig } from 'lib/commandBarConfigs/authCommandConfig'
import { kclManager, sceneInfra, engineCommandManager } from 'lib/singletons'
import { uuidv4 } from 'lib/utils'
import { IndexLoaderData } from 'lib/types'
import { settings } from 'lib/settings/initialSettings'
import {
  createSettingsCommand,
  settingsWithCommandConfigs,
} from 'lib/commandBarConfigs/settingsCommandConfig'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { Command } from 'lib/commandTypes'
import { BaseUnit } from 'lib/settings/settingsTypes'
import { saveSettings } from 'lib/settings/settingsUtils'

type MachineContext<T extends AnyStateMachine> = {
  state: StateFrom<T>
  context: ContextFrom<T>
  send: Prop<InterpreterFrom<T>, 'send'>
}

type SettingsAuthContextType = {
  auth: MachineContext<typeof authMachine>
  settings: MachineContext<typeof settingsMachine>
}

// a little hacky for sure, open to changing it
// this implies that we should only even have one instance of this provider mounted at any one time
// but I think that's a safe assumption
let settingsStateRef: (typeof settingsMachine)['context'] | undefined
export const getSettingsState = () => settingsStateRef

export const SettingsAuthContext = createContext({} as SettingsAuthContextType)

export const SettingsAuthProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const loadedSettings = useRouteLoaderData(paths.INDEX) as typeof settings
  const loadedProject = useRouteLoaderData(paths.FILE) as IndexLoaderData
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
  const navigate = useNavigate()
  const { commandBarSend } = useCommandsContext()

  const [settingsState, settingsSend, settingsActor] = useMachine(
    settingsMachine,
    {
      context: loadedSettings,
      actions: {
        //TODO: batch all these and if that's difficult to do from tsx,
        // make it easy to do

        setClientSideSceneUnits: (context, event) => {
          const newBaseUnit =
            event.type === 'set.modeling.defaultUnit'
              ? (event.data.value as BaseUnit)
              : context.modeling.defaultUnit.current
          sceneInfra.baseUnit = newBaseUnit
        },
        setEngineTheme: (context) => {
          engineCommandManager.sendSceneCommand({
            cmd_id: uuidv4(),
            type: 'modeling_cmd_req',
            cmd: {
              type: 'set_background_color',
              color: getThemeColorForEngine(context.app.theme.current),
            },
          })

          const opposingTheme = getOppositeTheme(context.app.theme.current)
          engineCommandManager.sendSceneCommand({
            cmd_id: uuidv4(),
            type: 'modeling_cmd_req',
            cmd: {
              type: 'set_default_system_properties',
              color: getThemeColorForEngine(opposingTheme),
            },
          })
        },
        setEngineEdges: (context) => {
          engineCommandManager.sendSceneCommand({
            cmd_id: uuidv4(),
            type: 'modeling_cmd_req',
            cmd: {
              type: 'edge_lines_visible' as any, // TODO update kittycad.ts to get this new command type
              hidden: !context.modeling.highlightEdges.current,
            },
          })
        },
        toastSuccess: (_, event) => {
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
        'Execute AST': () => kclManager.executeCode(true),
        persistSettings: (context) =>
          saveSettings(context, loadedProject?.project?.name),
      },
    }
  )
  settingsStateRef = settingsState.context

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

    commandBarSend({ type: 'Add commands', data: { commands: commands } })

    return () => {
      commandBarSend({
        type: 'Remove commands',
        data: { commands },
      })
    }
  }, [
    settingsState,
    settingsSend,
    settingsActor,
    commandBarSend,
    settingsWithCommandConfigs,
  ])

  // Listen for changes to the system theme and update the app theme accordingly
  // This is only done if the theme setting is set to 'system'.
  // It can't be done in XState (in an invoked callback, for example)
  // because there doesn't seem to be a good way to listen to
  // events outside of the machine that also depend on the machine's context
  useEffect(() => {
    const matcher = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (e: MediaQueryListEvent) => {
      if (settingsState.context.app.theme.current !== 'system') return
      setThemeClass(e.matches ? Themes.Dark : Themes.Light)
    }

    matcher.addEventListener('change', listener)
    return () => matcher.removeEventListener('change', listener)
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

  // Auth machine setup
  const [authState, authSend, authActor] = useMachine(authMachine, {
    actions: {
      goToSignInPage: () => {
        navigate(paths.SIGN_IN)
        logout()
      },
      goToIndexPage: () => {
        if (window.location.pathname.includes(paths.SIGN_IN)) {
          navigate(paths.INDEX)
        }
      },
    },
  })

  useStateMachineCommands({
    machineId: 'auth',
    state: authState,
    send: authSend,
    commandBarConfig: authCommandBarConfig,
    actor: authActor,
  })

  return (
    <SettingsAuthContext.Provider
      value={{
        auth: {
          state: authState,
          context: authState.context,
          send: authSend,
        },
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

export function logout() {
  localStorage.removeItem(TOKEN_PERSIST_KEY)
  return (
    !isTauri() &&
    fetch(withBaseUrl('/logout'), {
      method: 'POST',
      credentials: 'include',
    })
  )
}
