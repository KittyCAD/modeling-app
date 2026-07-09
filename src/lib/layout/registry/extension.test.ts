import type { UserFeature } from '@kittycad/lib'
import {
  Registry,
  defineRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import { createSettings } from '@src/lib/settings/initialSettings'
import { playwrightLayoutConfig } from '@src/lib/layout/configs/playwright'
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

function createSettingsService() {
  const settings = createSettings()
  const snapshot = {
    value: 'idle',
    context: settings,
  }
  const actor = {
    getSnapshot: () => snapshot,
    subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    send: vi.fn(),
  }

  return {
    actor,
    current: signal(settings),
    get: () => settings,
    send: actor.send,
    useSettings: () => settings,
  } as unknown as SettingsRegistryService
}

function createRuntimeService() {
  const current = signal(playwrightRuntime)
  return {
    current,
    get: () => current.value,
    refresh: () => current.value,
  }
}

function createUserFeaturesService(): UserFeaturesRegistryService {
  const context = signal({ featureIds: new Set<UserFeature>() })
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
    has: (_featureFlagId: UserFeature, defaultValue: boolean) => defaultValue,
    useContext: () => context.value,
    useHas: (_featureFlagId: UserFeature, defaultValue: boolean) =>
      defaultValue,
  } as unknown as UserFeaturesRegistryService
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
})
