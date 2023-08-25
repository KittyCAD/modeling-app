import { createActorContext } from '@xstate/react'
import { useNavigate } from 'react-router-dom'
import { paths } from '../Router'
import {
  authCommandBarMeta,
  authMachine,
  TOKEN_PERSIST_KEY,
} from '../lib/authMachine'
import withBaseUrl from '../lib/withBaseURL'
import React, { useContext, useState } from 'react'
import CommandBar, { CommandsContext } from '../components/CommandBar'
import { Command } from '../lib/commands'
import useStateMachineCommands from './useStateMachineCommands'

export const AuthMachineContext = createActorContext(authMachine)

export const GlobalStateProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [commands, internalSetCommands] = useState([] as Command[])
  const [commandBarOpen, setCommandBarOpen] = useState(false)
  const navigate = useNavigate()

  const addCommands = (newCommands: Command[]) => {
    internalSetCommands((prevCommands) => [...newCommands, ...prevCommands])
  }
  const removeCommands = (newCommands: Command[]) => {
    internalSetCommands((prevCommands) =>
      prevCommands.filter((command) => !newCommands.includes(command))
    )
  }

  return (
    <AuthMachineContext.Provider
      machine={() =>
        authMachine.withConfig({
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
      }
    >
      <CommandsContext.Provider
        value={{
          commands,
          addCommands,
          removeCommands,
          commandBarOpen,
          setCommandBarOpen,
        }}
      >
        {children}
        <CommandBar />
      </CommandsContext.Provider>
    </AuthMachineContext.Provider>
  )
}

export function useAuthMachine<T>(
  selector: (
    state: Parameters<Parameters<typeof AuthMachineContext.useSelector>[0]>[0]
  ) => T = () => null as T
): [T, ReturnType<typeof AuthMachineContext.useActor>[1]] {
  // useActor api normally `[state, send] = useActor`
  // we're only interested in send because of the selector
  const send = AuthMachineContext.useActor()[1]

  const selection = AuthMachineContext.useSelector(selector)
  return [selection, send]
}

export function logout() {
  const url = withBaseUrl('/logout')
  localStorage.removeItem(TOKEN_PERSIST_KEY)
  return fetch(url, {
    method: 'POST',
    credentials: 'include',
  })
}

export function AuthMachineCommandProvider(props: React.PropsWithChildren<{}>) {
  const [state, send] = AuthMachineContext.useActor()
  const { commands } = useContext(CommandsContext)

  useStateMachineCommands({
    state,
    send,
    commands,
    commandBarMeta: authCommandBarMeta,
    owner: 'auth',
  })

  return <>{props.children}</>
}
