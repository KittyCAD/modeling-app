import type { Feature } from '@kittycad/lib'
import {
  defineRegistryItem,
  provide,
  provideService,
  Registry,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { EXPERIMENTAL_POINT_AND_CLICK_FLAG } from '@src/lib/constants'
import {
  DefaultLayoutToolbarID,
  defaultLayoutConfig,
} from '@src/lib/layout/configs/default'
import { playwrightLayoutConfig } from '@src/lib/layout/configs/playwright'
import { applyFeatureCodeLayout } from '@src/lib/layout/featureCodeLayout'
import {
  layoutService,
  layoutUserFeatureTransformationsValueSpec,
} from '@src/lib/layout/registry/contract'
import layoutRegistryItem from '@src/lib/layout/registry/extension'
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

  it('applies the tab preference to loading, opening, contributions, and resets', () => {
    const settings = createSettings()
    settings.textEditor.featureTreeAboveCode.user = true
    const service = createSettingsService({ settings })

    const savedLayout = togglePaneLayoutNode({
      rootLayout: structuredClone(playwrightLayoutConfig),
      targetNodeId: 'variables',
      shouldExpand: true,
      paneOpenBehavior: settings.layout.paneOpenBehavior.current,
    })
    settings.layout.configs.user = {
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

    // Exercise opening tabs both before and after the current tab's index.
    layout.togglePane('variables')
    expect(toolbar()).toMatchObject({ activeIndices: [1], sizes: [100] })
    settings.layout.paneOpenBehavior.user = 'single'
    layout.togglePane('feature-tree')
    expect(toolbar()).toMatchObject({ activeIndices: [0], sizes: [100] })
    layout.togglePane('feature-tree')
    expect(toolbar()).toMatchObject({ activeIndices: [], sizes: [] })
    layout.togglePane('code')
    expect(toolbar()).toMatchObject({ activeIndices: [1], sizes: [100] })

    settings.layout.paneOpenBehavior.user = 'multiple'
    layout.togglePane('variables')
    expect(toolbar()).toMatchObject({ activeIndices: [1, 3], sizes: [50, 50] })
    settings.layout.paneOpenBehavior.user = 'single'

    expect(toolbar()).toMatchObject({ activeIndices: [1], sizes: [100] })
    // Restoring multiple mode does not reopen panes that single mode closed.
    settings.layout.paneOpenBehavior.user = 'multiple'
    expect(toolbar()).toMatchObject({ activeIndices: [1], sizes: [100] })
    settings.layout.paneOpenBehavior.user = 'single'

    layout.openPane('variables')
    expect(toolbar()).toMatchObject({ activeIndices: [3], sizes: [100] })
    layout.openPane('variables')
    expect(toolbar()).toMatchObject({ activeIndices: [3], sizes: [100] })
    layout.openPane('code')
    expect(toolbar()).toMatchObject({ activeIndices: [1], sizes: [100] })

    layout.applyContributions([
      {
        id: 'extra-tab',
        kind: 'area',
        initiallyOpen: true,
        pane: {
          id: 'extra-tab',
          label: 'Extra',
          icon: 'code',
          type: LayoutType.Simple,
          areaType: AreaType.Code,
        },
        placement: {
          targetPaneId: DefaultLayoutToolbarID.Left,
          position: 'start',
        },
      },
    ])
    expect(toolbar()).toMatchObject({ activeIndices: [0], sizes: [100] })
    layout.reset()
    expect(toolbar()).toMatchObject({ activeIndices: [1], sizes: [100] })
  })

  it('opens panes idempotently without changing sibling sizes or previous snapshots', () => {
    const settings = createSettings()
    settings.layout.configs.user = {
      default: createLayoutWithMetadata(
        structuredClone(playwrightLayoutConfig)
      ),
    }
    registry = new Registry()
    registry.configure([
      defineRegistryItem({
        id: 'test-dependencies',
        providesServices: [
          provideService(runtimeService, createRuntimeService()),
          provideService(settingsService, createSettingsService({ settings })),
          provideService(userFeaturesService, createUserFeaturesService()),
        ],
      }),
      layoutRegistryItem,
    ])
    const layout = registry.get(layoutService)
    const initial = structuredClone(layout.get())
    expect(layout.openPane('code')).toEqual(initial)
    expect(layout.openPane('code')).toEqual(initial)

    layout.togglePane('code')
    const closed = layout.get()
    const closedSnapshot = structuredClone(closed)
    const opened = layout.openPane('code')
    expect(opened).toBe(layout.signal.value)
    expect(closed).toEqual(closedSnapshot)
    expect(
      findLayoutChildNode({
        rootLayout: opened,
        targetNodeId: DefaultLayoutToolbarID.Left,
      })
    ).toMatchObject({
      activeIndices: [1],
      sizes: [100],
    })

    layout.openPane('variables')
    const resized = structuredClone(layout.get())
    const toolbar = findLayoutChildNode({
      rootLayout: resized,
      targetNodeId: DefaultLayoutToolbarID.Left,
    })
    if (toolbar?.type !== LayoutType.Panes) {
      throw new Error('Expected a pane toolbar')
    }
    expect(toolbar.activeIndices).toEqual([1, 3])
    toolbar.sizes = [25, 75]
    layout.set(resized)
    expect(layout.openPane('code')).toEqual(resized)
    expect(layout.openPane('variables')).toEqual(resized)
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

    expect(layout.get()).toEqual(
      applyFeatureCodeLayout(playwrightLayoutConfig, false)
    )
    expect(layout.signal.value).toEqual(
      applyFeatureCodeLayout(playwrightLayoutConfig, false)
    )
    expect(layout).toMatchObject({
      applyContributions: expect.any(Function),
    })
    const preference = registry.get(settingsService).get()
      .textEditor.featureTreeAboveCode
    preference.user = true
    expect(
      findLayoutChildNode({
        rootLayout: layout.get(),
        targetNodeId: 'feature-tree',
      })
    ).toBeDefined()
    const toolbar = findLayoutChildNode({
      rootLayout: layout.get(),
      targetNodeId: 'left-toolbar',
    })
    expect(toolbar).toMatchObject({ activeIndices: [0, 1] })
    preference.user = false
    expect(
      findLayoutChildNode({
        rootLayout: layout.get(),
        targetNodeId: 'feature-tree',
      })
    ).toBeUndefined()
    layout.openPane('feature-tree')
    expect(
      findLayoutChildNode({
        rootLayout: layout.get(),
        targetNodeId: 'left-toolbar',
      })
    ).toMatchObject({ activeIndices: [1] })
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
})
