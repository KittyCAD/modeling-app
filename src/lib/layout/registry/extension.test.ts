import type { Feature } from '@kittycad/lib'
import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { BODIES_PANE_FEATURE_FLAG } from '@src/lib/constants'
import {
  DefaultLayoutPaneID,
  defaultLayoutConfig,
} from '@src/lib/layout/configs/default'
import { playwrightLayoutConfig } from '@src/lib/layout/configs/playwright'
import type { Layout } from '@src/lib/layout/types'
import { AreaType, LayoutType } from '@src/lib/layout/types'
import {
  createLayoutWithMetadata,
  findLayoutChildNode,
} from '@src/lib/layout/utils'
import { createSettings } from '@src/lib/settings/initialSettings'
import {
  type RuntimeInfo,
  runtimeService,
} from '@src/registry/contracts/runtime'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import { settingsService } from '@src/registry/contracts/settings'
import type { UserFeaturesRegistryService } from '@src/registry/contracts/userFeatures'
import { userFeaturesService } from '@src/registry/contracts/userFeatures'
import layoutRegistryItem from '@src/lib/layout/registry/extension'
import { layoutService } from '@src/lib/layout/registry/contract'
import { afterEach, describe, expect, it, vi } from 'vitest'

const playwrightRuntime: RuntimeInfo = {
  target: 'web',
  hasWindow: true,
  isDesktop: false,
  isWeb: true,
  isServer: false,
  isPlaywright: true,
}

const webRuntime: RuntimeInfo = {
  ...playwrightRuntime,
  isPlaywright: false,
}

type TestSettingsSnapshot = {
  value: string
  context: ReturnType<typeof createSettings>
}

type TestSettingsRegistryService = SettingsRegistryService & {
  resolve: () => void
}

function createSettingsService({
  settings = createSettings(),
  initialValue = 'idle',
}: {
  settings?: ReturnType<typeof createSettings>
  initialValue?: string
} = {}): TestSettingsRegistryService {
  let snapshot: TestSettingsSnapshot = {
    value: initialValue,
    context: settings,
  }
  const subscribers = new Set<(snapshot: TestSettingsSnapshot) => void>()
  const actor = {
    getSnapshot: () => snapshot,
    subscribe: vi.fn((subscriber: (snapshot: TestSettingsSnapshot) => void) => {
      subscribers.add(subscriber)
      return { unsubscribe: vi.fn(() => subscribers.delete(subscriber)) }
    }),
    send: vi.fn(),
  }

  return {
    actor,
    current: signal(settings),
    get: () => settings,
    send: actor.send,
    useSettings: () => settings,
    resolve: () => {
      snapshot = {
        value: 'idle',
        context: settings,
      }
      for (const subscriber of subscribers) {
        subscriber(snapshot)
      }
    },
  } as unknown as TestSettingsRegistryService
}

function createRuntimeService(runtimeInfo = playwrightRuntime) {
  const current = signal(runtimeInfo)
  return {
    current,
    get: () => current.value,
    refresh: () => current.value,
  }
}

function createUserFeaturesService(
  featureIds: readonly Feature[] = []
): UserFeaturesRegistryService & {
  setFeatureIds: (featureIds: readonly Feature[]) => void
} {
  const context = signal({ featureIds: new Set(featureIds) })
  const snapshot = {
    context: context.value,
    matches: () => true,
  }
  const state = signal(snapshot)
  const ready = signal(true)
  const actor = {
    getSnapshot: () => snapshot,
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    stop: vi.fn(),
  }

  return {
    actor,
    send: vi.fn(),
    state,
    context,
    contextSignal: context,
    ready,
    has: (_featureFlagId: Feature, defaultValue: boolean) => defaultValue,
    useContext: () => context.value,
    useHas: (_featureFlagId: Feature, defaultValue: boolean) => defaultValue,
    setFeatureIds: (nextFeatureIds: readonly Feature[]) => {
      context.value = { featureIds: new Set(nextFeatureIds) }
    },
  } as unknown as UserFeaturesRegistryService & {
    setFeatureIds: (featureIds: readonly Feature[]) => void
  }
}

function hasBodiesPane(rootLayout: Layout) {
  const featureTreePane = findLayoutChildNode({
    rootLayout,
    targetNodeId: DefaultLayoutPaneID.FeatureTree,
  })

  return (
    featureTreePane?.type === LayoutType.Splits &&
    featureTreePane.children.some(
      (child) =>
        child.type === LayoutType.Simple && child.areaType === AreaType.Bodies
    )
  )
}

describe('layout extension', () => {
  let registry: Registry | undefined

  afterEach(() => {
    registry?.[Symbol.dispose]()
    registry = undefined
  })

  it('provides the app layout service from runtime, settings, and feature services', () => {
    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-runtime',
        providesServices: [
          provideService(runtimeService, createRuntimeService()),
        ],
      }),
      defineRegistryItem({
        id: 'test-settings',
        providesServices: [
          provideService(settingsService, createSettingsService()),
        ],
      }),
      defineRegistryItem({
        id: 'test-user-features',
        providesServices: [
          provideService(userFeaturesService, createUserFeaturesService()),
        ],
      }),
      layoutRegistryItem,
    ])

    const layout = registry.get(layoutService)

    expect(layout.get()).toEqual(playwrightLayoutConfig)
    expect(layout.signal.value).toEqual(playwrightLayoutConfig)
    expect(layout).toMatchObject({
      applyContributions: expect.any(Function),
    })
  })

  it('syncs bodies pane when feature flags load after settings hydrate', () => {
    const settings = createSettings()
    settings.layout.configs.user = {
      default: createLayoutWithMetadata(structuredClone(defaultLayoutConfig)),
    }
    const testSettingsService = createSettingsService({
      settings,
      initialValue: 'loadingUser',
    })
    const testUserFeaturesService = createUserFeaturesService()

    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-runtime',
        providesServices: [
          provideService(runtimeService, createRuntimeService(webRuntime)),
        ],
      }),
      defineRegistryItem({
        id: 'test-settings',
        providesServices: [
          provideService(settingsService, testSettingsService),
        ],
      }),
      defineRegistryItem({
        id: 'test-user-features',
        providesServices: [
          provideService(userFeaturesService, testUserFeaturesService),
        ],
      }),
      layoutRegistryItem,
    ])

    const layout = registry.get(layoutService)
    testSettingsService.resolve()
    expect(hasBodiesPane(layout.get())).toBe(false)

    testUserFeaturesService.setFeatureIds([BODIES_PANE_FEATURE_FLAG])

    expect(hasBodiesPane(layout.get())).toBe(true)
  })
})
