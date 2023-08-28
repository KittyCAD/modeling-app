import Loading from './components/Loading'
import { GlobalStateContext } from './components/GlobalStateProvider'
import { useContext } from 'react'

// Wrapper around protected routes, used in src/Router.tsx
export const Auth = ({ children }: React.PropsWithChildren) => {
  const {
    auth: { state },
  } = useContext(GlobalStateContext)
  const isLoggedIn = state.matches('checkIfLoggedIn')

  return isLoggedIn ? (
    <Loading>Loading KittyCAD Modeling App...</Loading>
  ) : (
    <>{children}</>
  )
}
