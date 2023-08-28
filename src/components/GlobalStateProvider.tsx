import { useMachine } from '@xstate/react'
import { useNavigate } from 'react-router-dom'
import { paths } from '../Router'
import {
  authCommandBarMeta,
  authMachine,
  TOKEN_PERSIST_KEY,
} from '../machines/authMachine'
import withBaseUrl from '../lib/withBaseURL'
import React, { useContext, createContext, useEffect, useRef } from 'react'
import { CommandsContext } from './CommandBar'
import useStateMachineCommands from '../hooks/useStateMachineCommands'
import {
  SETTINGS_PERSIST_KEY,
  settingsCommandBarMeta,
  settingsMachine,
} from 'machines/settingsMachine'
import { toast } from 'react-hot-toast'
import { setThemeClass } from 'lib/theme'
import {
  AnyStateMachine,
  ContextFrom,
  InterpreterFrom,
  Prop,
  StateFrom,
} from 'xstate'

type MachineContext<T extends AnyStateMachine> = {
  state: StateFrom<T>
  context: ContextFrom<T>
  send: Prop<InterpreterFrom<T>, 'send'>
}

type GlobalContext = {
  auth: MachineContext<typeof authMachine>
  settings: MachineContext<typeof settingsMachine>
}

export const GlobalStateContext = createContext({} as GlobalContext)

export const GlobalStateProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const navigate = useNavigate()
  const { commands } = useContext(CommandsContext)

  // Settings machine setup
  const retrievedSettings = useRef(
    localStorage?.getItem(SETTINGS_PERSIST_KEY) || '{}'
  )
  const persistedSettings = Object.assign(
    settingsMachine.initialState.context,
    JSON.parse(retrievedSettings.current) as Partial<
      (typeof settingsMachine)['context']
    >
  )

  const [settingsState, settingsSend] = useMachine(settingsMachine, {
    context: persistedSettings,
    actions: {
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
    },
  })

  useStateMachineCommands({
    state: settingsState,
    send: settingsSend,
    commands,
    owner: 'settings',
    commandBarMeta: settingsCommandBarMeta,
  })

  useEffect(
    () => setThemeClass(settingsState.context.theme),
    [settingsState.context.theme]
  )

  // Auth machine setup
  const [authState, authSend] = useMachine(authMachine, {
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
    state: authState,
    send: authSend,
    commands,
    commandBarMeta: authCommandBarMeta,
    owner: 'auth',
  })

  return (
    <GlobalStateContext.Provider
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
    </GlobalStateContext.Provider>
  )
}

export default GlobalStateProvider

export function logout() {
  const url = withBaseUrl('/logout')
  localStorage.removeItem(TOKEN_PERSIST_KEY)
  return fetch(url, {
    method: 'POST',
    credentials: 'include',
  })
}
