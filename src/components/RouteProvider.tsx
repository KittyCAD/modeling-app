import { useEffect, useState, createContext, ReactNode } from 'react'
import { useNavigation, useLocation } from 'react-router-dom'
import { PATHS } from 'lib/paths'
import { markOnce } from 'lib/performance'
import { sceneEntitiesManager } from 'lib/singletons'

export const RouteProviderContext = createContext({})

export function RouteProvider({ children }: { children: ReactNode }) {
  const [first, setFirstState] = useState(true)
  const navigation = useNavigation()
  const location = useLocation()

  const [route, setRoute] = useState({
    to: location.pathname,
    from: location.pathname,
  })

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

  // Save off previous routes so we know the to and from to make logic decisions
  useEffect(() => {
    setRoute((prev) => ({ to: location.pathname, from: prev.to }))
  }, [location])

  useEffect(() => {
    if (route.to === '/home' && route.from !== '/home') {
      // Redirecting from the file to the home page requires the file page to be cleaned up
      // We do not need this on every route loader since you can load the settings within the file loader
      // and you wouldn't want to clean up the page.
      // The DOM elements in the file loader still exist in the page when it is redirected. If they are not cleaned up
      // you can load old state. We should purge the DOM elements.
      fileLoaderPageCleanup()
        .then(() => {
          // NO OP
          // Do not await this promise since it would block the redirect.
        })
        .catch((e) => {
          console.error(e)
          console.error('failed to cleanup file page from home redirect')
        })
    }
  }, [route])

  return (
    <RouteProviderContext.Provider value={{}}>
      {children}
    </RouteProviderContext.Provider>
  )
}

async function fileLoaderPageCleanup() {
  // Always try to tear down a sketch since this is safe to call multiple times
  // If you route away to a completely different page we need to gracefully clean up the previous page's DOM.
  await sceneEntitiesManager.tearDownSketch()
}
