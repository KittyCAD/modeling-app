import { useMachine } from '@xstate/react'
import { useLoaderData, useNavigate } from 'react-router-dom'
import { paths } from 'lib/paths'
import { authMachine, TOKEN_PERSIST_KEY } from '../machines/authMachine'
import withBaseUrl from '../lib/withBaseURL'
import React, { createContext, useEffect } from 'react'
import useStateMachineCommands from '../hooks/useStateMachineCommands'
import { settingsMachine } from 'machines/settingsMachine'
import {
  fallbackLoadedSettings,
  validateSettings,
} from 'lib/settings/settingsUtils'
import { toast } from 'react-hot-toast'
import { setThemeClass, Themes } from 'lib/theme'
import {
  AnyStateMachine,
  ContextFrom,
  InterpreterFrom,
  Prop,
  StateFrom,
} from 'xstate'
import { isTauri } from 'lib/isTauri'
import { settingsCommandBarConfig } from 'lib/commandBarConfigs/settingsCommandConfig'
import { authCommandBarConfig } from 'lib/commandBarConfigs/authCommandConfig'
import { sceneInfra } from 'clientSideScene/sceneInfra'
import { kclManager } from 'lang/KclSingleton'

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
  const loadedSettings = useLoaderData() as ReturnType<typeof validateSettings>
  return (
    <SettingsAuthProviderBase loadedSettings={loadedSettings}>
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
  const loadedSettings = fallbackLoadedSettings
  return (
    <SettingsAuthProviderBase loadedSettings={loadedSettings}>
      {children}
    </SettingsAuthProviderBase>
  )
}

export const SettingsAuthProviderBase = ({
  children,
  loadedSettings,
}: {
  children: React.ReactNode
  loadedSettings: ReturnType<typeof validateSettings>
}) => {
  const { settings: initialLoadedContext } = loadedSettings
  const navigate = useNavigate()

  const [settingsState, settingsSend, settingsActor] = useMachine(
    settingsMachine,
    {
      context: initialLoadedContext,
      actions: {
        setClientSideSceneUnits: (context, event) => {
          const newBaseUnit =
            event.type === 'Set Base Unit'
              ? event.data.baseUnit
              : context.baseUnit
          sceneInfra.baseUnit = newBaseUnit
        },
        toastSuccess: (context, event) => {
          const truncatedNewValue =
            'data' in event && event.data instanceof Object
              ? (context[Object.keys(event.data)[0] as keyof typeof context]
                  .toString()
                  .substring(0, 28) as any)
              : undefined
          toast.success(
            event.type +
              (truncatedNewValue
                ? ` to "${truncatedNewValue}${
                    truncatedNewValue.length === 28 ? '...' : ''
                  }"`
                : '')
          )
        },
        'Execute AST': () => kclManager.executeAst(),
      },
    }
  )
  settingsStateRef = settingsState.context

  useStateMachineCommands({
    machineId: 'settings',
    state: settingsState,
    send: settingsSend,
    commandBarConfig: settingsCommandBarConfig,
    actor: settingsActor,
  })

  // Listen for changes to the system theme and update the app theme accordingly
  // This is only done if the theme setting is set to 'system'.
  // It can't be done in XState (in an invoked callback, for example)
  // because there doesn't seem to be a good way to listen to
  // events outside of the machine that also depend on the machine's context
  useEffect(() => {
    const matcher = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (e: MediaQueryListEvent) => {
      if (settingsState.context.theme !== 'system') return
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
