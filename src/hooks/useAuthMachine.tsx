import { InterpreterFrom, State, Sender } from 'xstate'
import { useInterpret, useActor, useSelector } from '@xstate/react'
import { createContext, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { paths } from '../Router'
import {
  authMachine,
  TOKEN_PERSIST_KEY,
  UserContext,
  Events,
} from '../lib/authMachine'
import withBaseUrl from '../lib/withBaseURL'

export const GlobalStateContext = createContext({
  authMachine: {} as InterpreterFrom<typeof authMachine>,
})

export const GlobalStateProvider = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const navigate = useNavigate()
  const _authMachine = useInterpret(authMachine, {
    actions: {
      goToSignInPage: () => {
        navigate(paths.SIGN_IN)
        logout()
      },
      goToIndexPage: () => navigate(paths.INDEX),
    },
  })

  return (
    <GlobalStateContext.Provider value={{ authMachine: _authMachine }}>
      {children}
    </GlobalStateContext.Provider>
  )
}

export function useAuthMachine<T>(
  selector?: (state: State<UserContext, Events>) => T
): [T, Sender<Events>] {
  const globalServices = useContext(GlobalStateContext)
  const [_, send] = useActor(globalServices.authMachine)
  const defaultFn = () => null as T
  const selection = useSelector(
    globalServices.authMachine,
    selector || defaultFn
  )
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
