import { createActorContext } from '@xstate/react'
import { useNavigate } from 'react-router-dom'
import { paths } from '../Router'
import { authMachine, TOKEN_PERSIST_KEY } from '../lib/authMachine'
import withBaseUrl from '../lib/withBaseURL'
import { useState } from 'react'
import ActionBar, { Action, ActionsContext } from '../components/ActionBar'

export const AuthMachineContext = createActorContext(authMachine)

export const GlobalStateProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const [actions, setActions] = useState([] as Action[])
  const navigate = useNavigate()
  return (
    <AuthMachineContext.Provider
      machine={() =>
        authMachine.withConfig({
          actions: {
            goToSignInPage: () => {
              navigate(paths.SIGN_IN)
              logout()
            },
            goToIndexPage: () => navigate(paths.INDEX),
          },
        })
      }
    >
      <ActionsContext.Provider value={{ actions, setActions }}>
        {children}
        <ActionBar />
      </ActionsContext.Provider>
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
