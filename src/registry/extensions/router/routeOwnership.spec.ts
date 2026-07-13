import { Registry } from '@kittycad/registry'
import { PATHS } from '@src/lib/paths'
import {
  createRegistryRouteObjects,
  routerRoutesValueSpec,
} from '@src/registry/contracts/router'
import { telemetryService } from '@src/registry/contracts/telemetry'
import homeExtension from '@src/registry/extensions/home'
import routerExtension from '@src/registry/extensions/router'
import settingsRegistryItem from '@src/registry/extensions/settings'
import telemetryExtension from '@src/registry/extensions/telemetry'
import { afterEach, describe, expect, it } from 'vitest'

const testApp = {} as Parameters<typeof createRegistryRouteObjects>[0]['app']

describe('feature-owned route contributions', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
  })

  it('lets concern extensions contribute children under shared app routes', () => {
    registry = new Registry()
    registry.configure([
      routerExtension,
      homeExtension,
      settingsRegistryItem,
      telemetryExtension,
    ])

    expect(registry.get(telemetryService).maybeWriteToDisk).toEqual(
      expect.any(Function)
    )

    const routes = createRegistryRouteObjects({
      app: testApp,
      routeContributions: registry.get(routerRoutesValueSpec),
    })
    const rootRoute = routes.find((route) => route.id === PATHS.INDEX)
    const fileRoute = rootRoute?.children?.find(
      (route) => route.id === PATHS.FILE
    )
    const homeRoute = rootRoute?.children?.find(
      (route) => route.id === PATHS.HOME
    )

    expect(rootRoute?.children?.map((route) => route.id).slice(0, 4)).toEqual([
      'router.index-loader',
      PATHS.FILE,
      PATHS.HOME,
      PATHS.SIGN_IN,
    ])
    expect(fileRoute?.children?.map((route) => route.id)).toEqual([
      `${PATHS.FILE}.settings`,
      `${PATHS.FILE}.onboarding`,
      `${PATHS.FILE}.telemetry`,
    ])
    expect(homeRoute?.children?.map((route) => route.id)).toEqual([
      `${PATHS.HOME}.index`,
      `${PATHS.HOME}.settings`,
      `${PATHS.HOME}.telemetry`,
    ])
  })
})
