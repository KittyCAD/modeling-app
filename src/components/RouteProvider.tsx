import { useEffect, useState, createContext, ReactNode } from 'react'
import { useNavigation, useLocation, useNavigate } from 'react-router-dom'
import { PATHS } from 'lib/paths'
import { markOnce } from 'lib/performance'
import { useAuthState } from 'machines/appMachine'

export const RouteProviderContext = createContext({})

export function RouteProvider({ children }: { children: ReactNode }) {
  const [first, setFirstState] = useState(true)
  const navigation = useNavigation()
  const navigate = useNavigate()
  const location = useLocation()
  const authState = useAuthState()
  useEffect(() => {
    // On initialization, the react-router-dom does not send a 'loading' state event.
    // it sends an idle event first.
    const pathname = first ? location.pathname : navigation.location?.pathname
    const isHome = pathname === PATHS.HOME
    const isFile =
      pathname?.includes(PATHS.FILE) &&
      pathname?.substring(pathname?.length - 4) === '.kcl'
    if (isHome) {
      markOnce('code/willLoadHome')
    } else if (isFile) {
      markOnce('code/willLoadFile')
    }
    setFirstState(false)
  }, [navigation])

  return (
    <RouteProviderContext.Provider value={{}}>
      {children}
    </RouteProviderContext.Provider>
  )
}
