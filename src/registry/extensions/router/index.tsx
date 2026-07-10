import { defineRegistryItem, provideService } from '@kittycad/registry'
import makeUrlPathRelative from '@src/lib/makeUrlPathRelative'
import { PATHS } from '@src/lib/paths'
import { baseLoader, fileLoader } from '@src/lib/routeLoaders'
import {
  defineRegistryRoute,
  lazyRouteComponent,
  lazyRouteComponentWithErrorBoundary,
  lazyRouteErrorBoundary,
  provideRoute,
  routerService,
  type RouterRegistryService,
} from '@src/registry/contracts/router'
import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

const routerServiceImpl: RouterRegistryService = {
  useLocation,
  useNavigate,
  useSearchParams,
}

const rootRoute = defineRegistryRoute({
  id: PATHS.INDEX,
  order: 0,
  buildRoute: () => ({
    lazy: lazyRouteComponent(async () => (await import('@src/Root')).default),
  }),
})

const indexRoute = defineRegistryRoute({
  id: 'router.index-loader',
  parentId: PATHS.INDEX,
  order: 0,
  buildRoute: ({ app }) => ({
    path: PATHS.INDEX,
    loader: baseLoader({ app }),
    lazy: lazyRouteErrorBoundary,
  }),
})

const fileRoute = defineRegistryRoute({
  id: PATHS.FILE,
  parentId: PATHS.INDEX,
  order: 10,
  buildRoute: ({ app }) => ({
    path: `${PATHS.FILE}/:id`,
    loader: fileLoader({ app }),
    lazy: lazyRouteComponentWithErrorBoundary(
      async () => (await import('./RouteShells')).FileRouteShell
    ),
  }),
})

const fileOnboardingRoute = defineRegistryRoute({
  id: `${PATHS.FILE}.onboarding`,
  parentId: PATHS.FILE,
  order: 10,
  buildRoute: () => ({
    path: `${makeUrlPathRelative(PATHS.ONBOARDING)}/*`,
    lazy: lazyRouteComponent(
      async () => (await import('./OnboardingRouteShell')).OnboardingRouteShell
    ),
  }),
})

const signInRoute = defineRegistryRoute({
  id: PATHS.SIGN_IN,
  parentId: PATHS.INDEX,
  order: 30,
  buildRoute: () => ({
    path: PATHS.SIGN_IN,
    lazy: lazyRouteComponentWithErrorBoundary(
      async () => (await import('@src/routes/SignIn')).default
    ),
  }),
})

const stagingRoutes = IS_STAGING_OR_DEBUG
  ? [
      defineRegistryRoute({
        id: 'router.error-page-test',
        parentId: PATHS.INDEX,
        order: 900,
        buildRoute: () => ({
          path: '/error-page-test',
          loader: () => {
            // eslint-disable-next-line suggest-no-throw/suggest-no-throw
            throw new Error('Manual ErrorPage test')
          },
          lazy: lazyRouteErrorBoundary,
        }),
      }),
      defineRegistryRoute({
        id: 'router.layout-test',
        parentId: PATHS.INDEX,
        order: 910,
        buildRoute: () => ({
          path: '/layout',
          lazy: lazyRouteComponentWithErrorBoundary(
            async () => (await import('@src/lib/layout/TestLayout')).TestLayout
          ),
        }),
      }),
    ]
  : []

const routerExtension = defineRegistryItem({
  id: 'router-extension',
  providesServices: [provideService(routerService, routerServiceImpl)],
  provides: [
    rootRoute,
    indexRoute,
    fileRoute,
    fileOnboardingRoute,
    signInRoute,
    ...stagingRoutes,
  ].map(provideRoute),
})

export default routerExtension
