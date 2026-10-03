import type { Feature } from '@kittycad/lib'
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
  togglePaneLayoutNode,
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

/**
 * Create a test settings object that you can alter for layout tests,
 * as well as a mock of the service that the layout system relies on.
 */
function createTestSettings() {
  const initialSettings = createSettings()
  const settings = signal(initialSettings)
  const service: SettingsRegistryService = {
    actor: {
      send: vi.fn(),
      getSnapshot: vi.fn().mockReturnValue({ value: 'idle' }),
    } as unknown as SettingsRegistryService['actor'],
    current: settings,
    get: () => settings.value,
    send: vi.fn(),
    useSettings: vi.fn(),
    userFilePath: vi.fn(),
  }
  return {
    settings,
    service,
  }
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

  it('toggles panes through the service and restores defaults on reset', () => {
    const { settings, service } = createTestSettings()

    const savedLayout = togglePaneLayoutNode({
      rootLayout: structuredClone(playwrightLayoutConfig),
      targetNodeId: 'variables',
      shouldExpand: true,
    })
    settings.value.layout.configs.user = {
      default: createLayoutWithMetadata(savedLayout),
    }

    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-dependencies',
        providesServices: [
          provideService(runtimeService, createRuntimeService()),
          provideService(settingsService, service),
          provideService(userFeaturesService, createUserFeaturesService()),
        ],
      }),
      layoutRegistryItem,
    ])
    const layout = registry.get(layoutService)
    const toolbar = () =>
      findLayoutChildNode({
        rootLayout: layout.get(),
        targetNodeId: DefaultLayoutToolbarID.Left,
      })

    expect(toolbar()).toMatchObject({ activeIndices: [1, 3], sizes: [50, 50] })
    layout.togglePane('variables')
    expect(toolbar()).toMatchObject({ activeIndices: [1], sizes: [100] })
    layout.togglePane('feature-tree')
    expect(toolbar()).toMatchObject({ activeIndices: [0, 1], sizes: [50, 50] })
    layout.togglePane('feature-tree')
    expect(toolbar()).toMatchObject({ activeIndices: [1], sizes: [100] })
    layout.togglePane('code')
    expect(toolbar()).toMatchObject({ activeIndices: [], sizes: [] })
    layout.togglePane('variables')
    expect(toolbar()).toMatchObject({ activeIndices: [3], sizes: [100] })
    layout.reset()
    expect(toolbar()).toMatchObject({ activeIndices: [1], sizes: [100] })
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
          provideService(settingsService, createTestSettings().service),
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
    const { settings, service } = createTestSettings()
    settings.value.layout.configs.user = {
      default: createLayoutWithMetadata(structuredClone(defaultLayoutConfig)),
    }
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
        providesServices: [provideService(settingsService, service)],
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
    expect(hasFeatureControlledPane(layout.get())).toBe(false)

    testUserFeaturesService.setFeatureIds([EXPERIMENTAL_POINT_AND_CLICK_FLAG])
    expect(hasFeatureControlledPane(layout.get())).toBe(true)

    testUserFeaturesService.setFeatureIds([])
    expect(hasFeatureControlledPane(layout.get())).toBe(false)
  })
})
