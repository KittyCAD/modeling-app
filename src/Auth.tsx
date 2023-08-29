import Loading from './components/Loading'
import { useGlobalStateContext } from 'hooks/useGlobalStateContext'

// Wrapper around protected routes, used in src/Router.tsx
export const Auth = ({ children }: React.PropsWithChildren) => {
  const {
    auth: { state },
  } = useGlobalStateContext()
  const isLoggedIn = state.matches('checkIfLoggedIn')

  return isLoggedIn ? (
    <Loading>Loading KittyCAD Modeling App...</Loading>
  ) : (
    <>{children}</>
  )
}
