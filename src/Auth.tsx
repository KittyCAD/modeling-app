import { AppMachineContext } from 'machines/appMachine'
import Loading from './components/Loading'

// Wrapper around protected routes, used in src/Router.tsx
export const Auth = ({ children }: React.PropsWithChildren) => {
  const isAuthenticating = AppMachineContext.useSelector(s => s.matches('Loading'))

  return isAuthenticating ? (
    <Loading>
      <span data-testid="initial-load">Loading Modeling App...</span>
    </Loading>
  ) : (
    <>{children}</>
  )
}
