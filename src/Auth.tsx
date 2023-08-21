import Loading from './components/Loading'
import { useAuthMachine } from './hooks/useAuthMachine'

// Wrapper around protected routes, used in src/Router.tsx
export const Auth = ({ children }: React.PropsWithChildren) => {
  const [isLoggedIn] = useAuthMachine((s) => s.matches('checkIfLoggedIn'))

  return isLoggedIn ? (
    <Loading>Loading KittyCAD Modeling App...</Loading>
  ) : (
    <>{children}</>
  )
}
