import { useSignals } from '@preact/signals-react/runtime'
import { MachineApiController } from '@src/components/MachineApiController'
import { NetworkContext } from '@src/hooks/useNetworkContext'
import { useNetworkStatus } from '@src/hooks/useNetworkStatus'
import { useApp, useSingletons } from '@src/lib/boot'
import { isDesktop } from '@src/lib/isDesktop'
import {
  createRegistryRouteObjects,
  routerRoutesValueSpec,
} from '@src/registry/contracts/router'
import { useEffect, useMemo } from 'react'
import {
  RouterProvider,
  createBrowserRouter,
  createHashRouter,
} from 'react-router-dom'

const createRouter = isDesktop() ? createHashRouter : createBrowserRouter
let nextRouterInstanceId = 0

/**
 * All routes in the app, used in src/lib/index.tsx
 * @returns RouterProvider
 */
export const Router = () => {
  useSignals()
  const app = useApp()
  const { kclManager } = useSingletons()
  const networkStatus = useNetworkStatus(kclManager.engineCommandManager)
  const routeContributions = app.registry.signal(routerRoutesValueSpec).value
  const routes = useMemo(
    () =>
      createRegistryRouteObjects({
        app,
        routeContributions,
      }),
    [app, routeContributions]
  )
  const routerInstance = useMemo(
    () => ({
      id: nextRouterInstanceId++,
      router: createRouter(routes),
    }),
    [routes]
  )

  // Route contributions are registry values, so plugin/slot reconfiguration can
  // change them at runtime. Recreating the data router is coarse, but it keeps
  // this prototype honest: a newly contributed route becomes matchable without a
  // page reload. A future iteration can use React Router's patchRoutesOnNavigation
  // for more surgical route additions if recreating the router proves too blunt.
  useEffect(() => () => routerInstance.router.dispose(), [routerInstance])

  return (
    <NetworkContext.Provider value={networkStatus}>
      <MachineApiController />
      <RouterProvider key={routerInstance.id} router={routerInstance.router} />
    </NetworkContext.Provider>
  )
}
