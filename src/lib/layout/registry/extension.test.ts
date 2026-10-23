import { resolveSceneBrowserLayout } from '@src/lib/featureTree/migrateLayout'
import { UserFeaturesState } from '@src/machines/userFeaturesMachine'
import type { UserFeature } from '@src/machines/userFeaturesMachine'
import { parseLayoutInner } from '@src/lib/layout/parse'
import { SCENE_BROWSER_FEATURE } from '@src/lib/sceneBrowser/featureFlag'
import {
  Registry,
  defineRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { EXPERIMENTAL_POINT_AND_CLICK_FLAG } from '@src/lib/constants'
import {
  DefaultLayoutToolbarID,
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
import {
  layoutService,
  layoutUserFeatureTransformationsValueSpec,
} from '@src/lib/layout/registry/contract'
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
  featureIds: readonly UserFeature[] = []
): UserFeaturesRegistryService & {
  setReady: (value: boolean) => void
  setFeatureIds: (featureIds: readonly UserFeature[]) => void
} {
  const context = signal({ featureIds: new Set(featureIds) })
  const snapshot = {
    context: context.value,
    matches: (state: UserFeaturesState) =>
      state ===
      (ready.value ? UserFeaturesState.Ready : UserFeaturesState.Loading),
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
    has: (feature: UserFeature, defaultValue: boolean) =>
      context.value.featureIds.has(feature) || defaultValue,
    useContext: () => context.value,
    useHas: (feature: UserFeature, defaultValue: boolean) =>
      context.value.featureIds.has(feature) || defaultValue,
    setReady: (value: boolean) => {
      ready.value = value
    },
    setFeatureIds: (nextFeatureIds: readonly UserFeature[]) => {
      context.value = { featureIds: new Set(nextFeatureIds) }
    },
  } as unknown as UserFeaturesRegistryService & {
    setReady: (value: boolean) => void
    setFeatureIds: (featureIds: readonly UserFeature[]) => void
  }
}

const FEATURE_CONTROLLED_PANE_ID = 'test-feature-controlled-pane'

function setFeatureControlledPaneEnabled(rootLayout: Layout, enabled: boolean) {
  const toolbar = findLayoutChildNode({
    rootLayout,
    targetNodeId: DefaultLayoutToolbarID.Left,
  })
  if (toolbar?.type !== LayoutType.Panes) {
    return rootLayout
  }

  const paneIndex = toolbar.children.findIndex(
    (child) => child.id === FEATURE_CONTROLLED_PANE_ID
  )
  if (enabled && paneIndex === -1) {
    toolbar.children.push({
      id: FEATURE_CONTROLLED_PANE_ID,
      label: 'Feature-controlled pane',
      icon: 'model',
      type: LayoutType.Simple,
      areaType: AreaType.Debug,
    })
  } else if (!enabled && paneIndex !== -1) {
    toolbar.children.splice(paneIndex, 1)
  }

  return rootLayout
}

function hasFeatureControlledPane(rootLayout: Layout) {
  return Boolean(
    findLayoutChildNode({
      rootLayout,
      targetNodeId: FEATURE_CONTROLLED_PANE_ID,
    })
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

  it('applies contributed user-feature transformations after settings hydrate', () => {
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
      defineRegistryItem({
        id: 'test-user-feature-layout',
        provides: [
          provide(layoutUserFeatureTransformationsValueSpec, {
            id: 'test-user-feature-layout',
            feature: EXPERIMENTAL_POINT_AND_CLICK_FLAG,
            transform: setFeatureControlledPaneEnabled,
          }),
        ],
      }),
      layoutRegistryItem,
    ])

    const layout = registry.get(layoutService)
    testSettingsService.resolve()
    expect(hasFeatureControlledPane(layout.get())).toBe(false)

    testUserFeaturesService.setFeatureIds([EXPERIMENTAL_POINT_AND_CLICK_FLAG])
    expect(hasFeatureControlledPane(layout.get())).toBe(true)

    testUserFeaturesService.setFeatureIds([])
    expect(hasFeatureControlledPane(layout.get())).toBe(false)
  })
  it('migrates only when the Scene browser flag is granted and restores the prior layout when revoked', () => {
    const settings = createSettings()
    const original = structuredClone(defaultLayoutConfig)
    settings.layout.configs.user = {
      default: createLayoutWithMetadata(original),
    }
    const features = createUserFeaturesService()
    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        providesServices: [
          provideService(runtimeService, createRuntimeService(webRuntime)),
          provideService(settingsService, createSettingsService({ settings })),
          provideService(userFeaturesService, features),
        ],
      }),
      layoutRegistryItem,
    ])
    const layout = registry.get(layoutService)
    expect(layout.get()).toEqual(original)
    features.setFeatureIds([SCENE_BROWSER_FEATURE])
    expect(layout.get()).toMatchObject({ sceneBrowserFallback: original })
    features.setFeatureIds([])
    expect(layout.get()).toEqual(parseLayoutInner(original))
  })
  it('waits for user features before deciding whether a saved migrated layout must be restored', () => {
    const settings = createSettings()
    const migrated = {
      ...resolveSceneBrowserLayout(defaultLayoutConfig, true),
      label: 'Saved Scene browser layout',
    }
    settings.layout.configs.user = {
      default: createLayoutWithMetadata(migrated),
    }
    const features = createUserFeaturesService()
    features.setReady(false)
    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        providesServices: [
          provideService(runtimeService, createRuntimeService(webRuntime)),
          provideService(settingsService, createSettingsService({ settings })),
          provideService(userFeaturesService, features),
        ],
      }),
      layoutRegistryItem,
    ])
    const layout = registry.get(layoutService)
    expect(layout.get().label).toBe('Saved Scene browser layout')
    features.setFeatureIds([SCENE_BROWSER_FEATURE])
    features.setReady(true)
    expect(layout.get().label).toBe('Saved Scene browser layout')
  })
})
