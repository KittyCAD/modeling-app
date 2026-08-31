import {
  defineRegistryItem,
  pluginsValueSpec,
  provideService,
  Registry,
} from '@kittycad/registry'
import { type Signal, signal } from '@preact/signals-core'
import {
  DefaultLayoutPaneID,
  DefaultLayoutToolbarID,
} from '@src/lib/layout/configs/default'
import {
  AreaType,
  type Layout,
  type LayoutService,
  LayoutType,
} from '@src/lib/layout/types'
import { zookeeperPromptRunningSignal } from '@src/lib/zookeeper/zookeeperPromptState'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import {
  layoutAreaLibraryValueSpec,
  layoutService,
} from '@src/registry/contracts/layout'
import { statusBarLocalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { describe, expect, it, vi } from 'vitest'

vi.mock(
  '@src/lib/zookeeper/components/ZookeeperConversationPaneWrapper',
  () => ({
    ZookeeperConversationPaneWrapper: () => null,
  })
)

vi.mock('@src/components/ZookeeperCreditsMenu', () => ({
  ZookeeperCreditsMenu: () => null,
}))

function zookeeperPaneLayout(activeIndices: number[] = [0]): Layout {
  return {
    id: DefaultLayoutToolbarID.Right,
    label: DefaultLayoutToolbarID.Right,
    type: LayoutType.Panes,
    side: 'inline-end',
    activeIndices,
    sizes: [100],
    splitOrientation: 'block',
    children: [
      {
        id: DefaultLayoutPaneID.Zookeeper,
        label: 'Zookeeper',
        type: LayoutType.Simple,
        areaType: AreaType.Zookeeper,
        icon: 'sparkles',
      },
    ],
  }
}

function createTestLayoutServiceRegistryItem(layoutSignal: Signal<Layout>) {
  const testLayoutService: LayoutService = {
    signal: layoutSignal,
    get: () => layoutSignal.value,
    set: (layout) => {
      layoutSignal.value = layout
    },
    reset: () => undefined,
    applyContributions: () => [],
  }

  return defineRegistryItem({
    id: 'test.layout-service',
    providesServices: [provideService(layoutService, testLayoutService)],
  })
}

describe('zookeeper plugin', () => {
  it('contributes the conversation pane and credits without a portal host', async () => {
    const { default: zookeeper } = await import('.')
    const layoutSignal = signal(zookeeperPaneLayout())
    const registry = new Registry()

    registry.configure([
      zookeeper,
      createTestLayoutServiceRegistryItem(layoutSignal),
    ])

    const plugin = registry
      .get(pluginsValueSpec)
      .find((candidate) => candidate.id === 'zookeeper')

    expect(plugin).toBeDefined()
    expect(
      registry.get(appHeaderItemsValueSpec).map((item) => item.id)
    ).not.toContain('zookeeper.runtime-host')
    const zookeeperArea = registry.get(layoutAreaLibraryValueSpec)[
      AreaType.Zookeeper
    ]
    expect(zookeeperArea).toMatchObject({
      shortcut: 'Ctrl + T',
    })
    zookeeperPromptRunningSignal.value = true
    expect(zookeeperArea?.getIcon?.(false)).toBe('loading')
    expect(zookeeperArea?.getIcon?.(true)).toBeUndefined()
    zookeeperPromptRunningSignal.value = false
    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toContain('zookeeper-credits')

    layoutSignal.value = zookeeperPaneLayout([])

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).not.toContain('zookeeper-credits')
  })

  it('removes and restores zookeeper contributions when toggled', async () => {
    const { default: zookeeper } = await import('.')
    const layoutSignal = signal(zookeeperPaneLayout())
    const registry = new Registry()

    registry.configure([
      zookeeper,
      createTestLayoutServiceRegistryItem(layoutSignal),
    ])

    const plugin = registry
      .get(pluginsValueSpec)
      .find((candidate) => candidate.id === 'zookeeper')

    expect(plugin).toBeDefined()
    if (!plugin) {
      throw new Error('Expected zookeeper plugin')
    }

    registry.get(plugin.service).disable()

    expect(registry.get(layoutAreaLibraryValueSpec)[AreaType.Zookeeper]).toBe(
      undefined
    )
    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).not.toContain('zookeeper-credits')
    expect(
      registry.get(appHeaderItemsValueSpec).map((item) => item.id)
    ).not.toContain('zookeeper.runtime-host')

    registry.get(plugin.service).enable()

    expect(
      registry.get(layoutAreaLibraryValueSpec)[AreaType.Zookeeper]
    ).toBeDefined()
    expect(
      registry.get(appHeaderItemsValueSpec).map((item) => item.id)
    ).not.toContain('zookeeper.runtime-host')
  })
})
