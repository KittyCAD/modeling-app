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
import {
  layoutAreaLibraryFacet,
  layoutService,
} from '@src/registry/contracts/layout'
import { statusBarLocalItemsFacet } from '@src/registry/contracts/statusBar'
import { plugins, provide, Registry } from 'plankton'
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
    togglePane: () => zookeeperPaneLayout(),
    openPane: () => zookeeperPaneLayout(),
  }
  return [provide(layoutService, testLayoutService)]
}

describe('zookeeper plugin', () => {
  it('contributes the conversation pane, running indicator, and credits', async () => {
    const { default: zookeeper } = await import('.')
    const layoutSignal = signal(zookeeperPaneLayout())
    const registry = new Registry()
    await registry.configure([
      zookeeper,
      createTestLayoutServiceRegistryItem(layoutSignal),
    ])

    const plugin = registry
      .get(plugins)
      .find((candidate) => candidate.id === 'zookeeper')

    expect(plugin).toBeDefined()
    const zookeeperArea = registry.get(layoutAreaLibraryFacet)[
      AreaType.Zookeeper
    ]
    expect(zookeeperArea).toMatchObject({
      shortcut: 'Ctrl + T',
    })
    zookeeperPromptRunningSignal.value = true
    expect(
      registry.get(layoutAreaLibraryFacet)[AreaType.Zookeeper]?.icon
    ).toBeUndefined()
    expect(
      registry.get(statusBarLocalItemsFacet).map((item) => item.id)
    ).toContain('zookeeper-credits')

    layoutSignal.value = zookeeperPaneLayout([])
    expect(registry.get(layoutAreaLibraryFacet)[AreaType.Zookeeper]?.icon).toBe(
      'loading'
    )
    expect(
      registry.get(statusBarLocalItemsFacet).map((item) => item.id)
    ).not.toContain('zookeeper-credits')

    layoutSignal.value = zookeeperPaneLayout()
    expect(
      registry.get(layoutAreaLibraryFacet)[AreaType.Zookeeper]?.icon
    ).toBeUndefined()

    layoutSignal.value = zookeeperPaneLayout([])
    zookeeperPromptRunningSignal.value = false
    expect(
      registry.get(layoutAreaLibraryFacet)[AreaType.Zookeeper]?.icon
    ).toBeUndefined()
  })

  it('removes and restores zookeeper contributions when toggled', async () => {
    const { default: zookeeper } = await import('.')
    const layoutSignal = signal(zookeeperPaneLayout())
    const registry = new Registry()
    await registry.configure([
      zookeeper,
      createTestLayoutServiceRegistryItem(layoutSignal),
    ])

    const plugin = registry
      .get(plugins)
      .find((candidate) => candidate.id === 'zookeeper')

    expect(plugin).toBeDefined()
    if (!plugin) {
      throw new Error('Expected zookeeper plugin')
    }
    await registry.required(plugin.service).disable()
    expect(registry.get(layoutAreaLibraryFacet)[AreaType.Zookeeper]).toBe(
      undefined
    )
    expect(
      registry.get(statusBarLocalItemsFacet).map((item) => item.id)
    ).not.toContain('zookeeper-credits')
    await registry.required(plugin.service).enable()
    expect(
      registry.get(layoutAreaLibraryFacet)[AreaType.Zookeeper]
    ).toBeDefined()
  })
})
