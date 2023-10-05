import Loading from './components/Loading'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'

// Wrapper around protected routes, used in src/Router.tsx
export const Auth = ({ children }: React.PropsWithChildren) => {
  const {
    auth: { state },
  } = useGlobalStateContext()
  const isLoggingIn = state.matches('checkIfLoggedIn')

  return isLoggingIn ? (
    <Loading>Loading KittyCAD Modeling App...</Loading>
  ) : (
    <>{children}</>
  )
}
