import { useMachine } from '@xstate/react'
import { useNavigate, useRouteLoaderData } from 'react-router-dom'
import { paths } from 'lib/paths'
import { authMachine, TOKEN_PERSIST_KEY } from '../machines/authMachine'
import withBaseUrl from '../lib/withBaseURL'
import React, { createContext, useEffect } from 'react'
import useStateMachineCommands from '../hooks/useStateMachineCommands'
import { settingsMachine } from 'machines/settingsMachine'
import { toast } from 'react-hot-toast'
import { getThemeColorForEngine, setThemeClass, Themes } from 'lib/theme'
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
import { v4 as uuidv4 } from 'uuid'
import { IndexLoaderData } from 'lib/types'
import { settings } from 'lib/settings/initialSettings'
import { writeToSettingsFiles } from 'lib/tauriFS'
import { createSettingsCommand } from 'lib/commandBarConfigs/settingsCommandConfig'
import { useCommandsContext } from 'hooks/useCommandsContext'
import { Command } from 'lib/commandTypes'

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
        setClientSideSceneUnits: (context, event) => {
          if (event.type !== 'set.modeling.units') return
          const newBaseUnit =
            event.type === 'set.modeling.units'
              ? event.data.value
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
        },
        toastSuccess: (context, event) => {
          const [category, setting] = event.type
            .replace(/^set./, '')
            .split('.') as [keyof typeof settings, string]
          const truncatedNewValue = event.data.value?.toString().slice(0, 28)
          const message =
            `Set ${decamelize(category, { separator: ' ' })}: ${decamelize(
              setting,
              { separator: ' ' }
            )}` +
            (truncatedNewValue
              ? ` to "${truncatedNewValue}${
                  truncatedNewValue.length === 28 ? '...' : ''
                }" at the ${event.data.level} level`
              : '')
          toast.success(message, {
            duration: message.split(' ').length * 100 + 1500,
          })
        },
        'Execute AST': () => kclManager.executeAst(),
        persistSettings: (context, event) => {
          if (isTauri()) {
            writeToSettingsFiles(context, loadedProject)
          } else {
            // TODO: persist settings to local storage otherwise
          }
        },
      },
    }
  )
  settingsStateRef = settingsState.context

  useEffect(() => {
    const commands = [
      createSettingsCommand(
        'modeling.defaultUnit',
        settingsSend,
        settingsActor
      ),
      createSettingsCommand(
        'app.theme',
        settingsSend,
        settingsActor
      ),
      createSettingsCommand(
        'textEditor.textWrapping',
        settingsSend,
        settingsActor
      )
    ].filter((c) => c !== null) as Command[]

    console.log('commands', commands)

    commandBarSend({ type: 'Add commands', data: { commands: commands } })

    return () => {
      commandBarSend({
        type: 'Remove commands',
        data: { commands },
      })
    }
  }, [settingsState])
  // useStateMachineCommands({
  //   machineId: 'settings',
  //   state: settingsState,
  //   send: settingsSend,
  //   commandBarConfig: settingsCommandBarConfig,
  //   actor: settingsActor,
  // })

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
