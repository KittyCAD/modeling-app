import Loading from '@src/components/Loading'
import {
  useAuthState,
  useToken,
  mlEphantManagerActor,
} from '@src/lib/singletons'
import { MlEphantManagerTransitions } from '@src/machines/mlEphantManagerMachine'

// Wrapper around protected routes, used in src/Router.tsx
export const Auth = ({ children }: React.PropsWithChildren) => {
  const authState = useAuthState()
  const isLoggingIn = authState.matches('checkIfLoggedIn')
  const token = useToken()

  if (!isLoggingIn) {
    // The earliest we can give machines their Zoo API token.
    mlEphantManagerActor.send({
      type: MlEphantManagerTransitions.SetApiToken,
      token,
    })
  }

  return isLoggingIn ? (
    <Loading className="h-screen w-screen">
      <span data-testid="initial-load">Loading Design Studio...</span>
    </Loading>
  ) : (
    <>{children}</>
  )
}
