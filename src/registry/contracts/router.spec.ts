import { Registry, Slot, defineRegistryItem, provide } from '@kittycad/registry'
import {
  createRegistryRouteObjects,
  defineRegistryRoute,
  provideRoute,
  routerRoutesValueSpec,
} from '@src/registry/contracts/router'
import { describe, expect, it } from 'vitest'

const testApp = {} as Parameters<typeof createRegistryRouteObjects>[0]['app']

const rootRoute = defineRegistryRoute({
  id: 'root',
  buildRoute: () => ({ path: '/' }),
})

const firstChildRoute = defineRegistryRoute({
  id: 'first-child',
  parentId: rootRoute.id,
  order: 20,
  buildRoute: () => ({ path: 'first' }),
})

const secondChildRoute = defineRegistryRoute({
  id: 'second-child',
  parentId: rootRoute.id,
  order: 10,
  buildRoute: () => ({ path: 'second' }),
})

describe('router registry contract', () => {
  it('builds a nested React Router tree from route contributions', () => {
    const routes = createRegistryRouteObjects({
      app: testApp,
      routeContributions: [rootRoute, firstChildRoute, secondChildRoute],
    })

    expect(routes).toEqual([
      {
        id: 'root',
        path: '/',
        children: [
          {
            id: 'second-child',
            path: 'second',
          },
          {
            id: 'first-child',
            path: 'first',
          },
        ],
      },
    ])
  })

  it('reacts when a runtime slot contributes a new route', () => {
    const registry = new Registry()
    const routeSlot = new Slot()

    registry.configure([
      defineRegistryItem({
        id: 'test-router-root',
        uses: [
          routeSlot.of(
            defineRegistryItem({
              id: 'test-router-initial-routes',
              provides: [provideRoute(rootRoute)],
            })
          ),
        ],
      }),
    ])

    const routeSignal = registry.signal(routerRoutesValueSpec)
    expect(routeSignal.value.map((route) => route.id)).toEqual(['root'])

    registry.reconfigure(routeSlot, [
      defineRegistryItem({
        id: 'test-router-updated-routes',
        provides: [provideRoute(rootRoute), provideRoute(secondChildRoute)],
      }),
    ])

    expect(routeSignal.value.map((route) => route.id)).toEqual([
      'root',
      'second-child',
    ])
    expect(
      createRegistryRouteObjects({
        app: testApp,
        routeContributions: routeSignal.value,
      })
    ).toEqual([
      {
        id: 'root',
        path: '/',
        children: [
          {
            id: 'second-child',
            path: 'second',
          },
        ],
      },
    ])
  })

  it('keeps the first route contribution for a duplicate id', () => {
    const registry = new Registry()
    const duplicateRootRoute = defineRegistryRoute({
      id: rootRoute.id,
      buildRoute: () => ({ path: '/duplicate' }),
    })

    registry.configure([
      defineRegistryItem({
        id: 'test-router-duplicates',
        provides: [
          provide(routerRoutesValueSpec, rootRoute),
          provide(routerRoutesValueSpec, duplicateRootRoute),
        ],
      }),
    ])

    expect(
      createRegistryRouteObjects({
        app: testApp,
        routeContributions: registry.get(routerRoutesValueSpec),
      })
    ).toEqual([
      {
        id: 'root',
        path: '/',
      },
    ])
  })

  it('provides keyed route contributions for registry-level replacement', () => {
    const registry = new Registry()

    registry.configure([
      defineRegistryItem({
        id: 'test-router-keyed',
        provides: [
          provideRoute(rootRoute),
          provideRoute({
            ...rootRoute,
            buildRoute: () => ({ path: '/replacement' }),
          }),
        ],
      }),
    ])

    expect(registry.get(routerRoutesValueSpec)).toHaveLength(1)
  })
})
