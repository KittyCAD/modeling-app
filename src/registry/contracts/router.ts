import {
  defineContract,
  defineService,
  defineValueSpec,
  provide,
} from '@kittycad/registry'
import type { App } from '@src/lib/app'
import type { ComponentType } from 'react'
import type {
  Location,
  NavigateFunction,
  RouteObject,
  SetURLSearchParams,
} from 'react-router-dom'

export type RouterRouteBuildContext = {
  app: App
}

export type RegistryRouteContribution = {
  id: string
  parentId?: string
  order?: number
  buildRoute: (
    context: RouterRouteBuildContext
  ) => Omit<RouteObject, 'id' | 'children'>
}

export type RouterRegistryService = {
  useLocation: () => Location
  useNavigate: () => NavigateFunction
  useSearchParams: () => [URLSearchParams, SetURLSearchParams]
}

const loadRouteErrorBoundary = async () =>
  (await import('@src/components/ErrorPage')).ErrorPage

export const lazyRouteComponent =
  (loadComponent: () => Promise<ComponentType>) => async () => ({
    Component: await loadComponent(),
  })

export const lazyRouteComponentWithErrorBoundary =
  (loadComponent: () => Promise<ComponentType>) => async () => ({
    Component: await loadComponent(),
    ErrorBoundary: await loadRouteErrorBoundary(),
  })

export const lazyRouteErrorBoundary = async () => ({
  ErrorBoundary: await loadRouteErrorBoundary(),
})

const byParentAndOrder = (
  inputs: readonly RegistryRouteContribution[]
): readonly RegistryRouteContribution[] => {
  const seen = new Set<string>()
  const deduped: RegistryRouteContribution[] = []

  for (const contribution of inputs) {
    if (seen.has(contribution.id)) {
      continue
    }

    seen.add(contribution.id)
    deduped.push(contribution)
  }

  return deduped.toSorted(
    (a, b) =>
      (a.parentId ?? '').localeCompare(b.parentId ?? '') ||
      (a.order ?? 0) - (b.order ?? 0)
  )
}

export const routerContract = defineContract({
  routerService: defineService<RouterRegistryService>('router.service'),
  routerRoutesValueSpec: defineValueSpec<
    RegistryRouteContribution,
    readonly RegistryRouteContribution[]
  >({
    name: 'router.routes',
    defaultValue: [],
    combine: byParentAndOrder,
  }),
})

export const { routerService, routerRoutesValueSpec } = routerContract

export function defineRegistryRoute<T extends RegistryRouteContribution>(
  contribution: T
): T {
  return contribution
}

export function provideRoute(contribution: RegistryRouteContribution) {
  return provide(routerRoutesValueSpec, contribution, { key: contribution.id })
}

export function createRegistryRouteObjects({
  app,
  routeContributions,
}: RouterRouteBuildContext & {
  routeContributions: readonly RegistryRouteContribution[]
}): RouteObject[] {
  const byParentId = new Map<string | undefined, RegistryRouteContribution[]>()

  for (const contribution of routeContributions) {
    const siblings = byParentId.get(contribution.parentId) ?? []
    siblings.push(contribution)
    byParentId.set(contribution.parentId, siblings)
  }

  const buildChildren = (parentId: string | undefined): RouteObject[] =>
    [...(byParentId.get(parentId) ?? [])]
      .toSorted((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((contribution) => {
        const route: RouteObject = {
          id: contribution.id,
          ...contribution.buildRoute({ app }),
        }
        const children = buildChildren(contribution.id)

        if (children.length === 0 || route.index) {
          return route
        }

        return {
          ...route,
          children,
        }
      })

  return buildChildren(undefined)
}
