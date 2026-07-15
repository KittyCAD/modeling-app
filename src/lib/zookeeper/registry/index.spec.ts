import { Registry, pluginsValueSpec } from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import {
  createLayoutService,
  createLayoutServiceRegistryItem,
} from '@src/lib/layout'
import {
  DefaultLayoutPaneID,
  DefaultLayoutToolbarID,
} from '@src/lib/layout/configs/default'
import { AreaType, type Layout, LayoutType } from '@src/lib/layout/types'
import { layoutAreaLibraryValueSpec } from '@src/registry/contracts/layout'
import { statusBarLocalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { describe, expect, it, vi } from 'vitest'

vi.mock(
  '@src/lib/zookeeper/components/MlEphantConversationPaneWrapper',
  () => ({
    MlEphantConversationPaneWrapper: () => null,
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
        id: DefaultLayoutPaneID.TTC,
        label: 'Zookeeper',
        type: LayoutType.Simple,
        areaType: AreaType.TTC,
        icon: 'sparkles',
      },
    ],
  }
}

describe('zookeeper plugin', () => {
  it('contributes the conversation pane and credits status item', async () => {
    const { default: zookeeper } = await import('.')
    const layoutSignal = signal(zookeeperPaneLayout())
    const registry = new Registry()

    registry.configure([
      zookeeper,
      createLayoutServiceRegistryItem(createLayoutService(layoutSignal)),
    ])

    const plugin = registry
      .get(pluginsValueSpec)
      .find((candidate) => candidate.id === 'zookeeper')

    expect(plugin).toBeDefined()
    expect(
      registry.get(layoutAreaLibraryValueSpec)[AreaType.TTC]
    ).toMatchObject({
      shortcut: 'Ctrl + T',
    })
    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toContain('zookeeper-credits')

    layoutSignal.value = zookeeperPaneLayout([])

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).not.toContain('zookeeper-credits')
  })

  it('removes zookeeper UI contributions when disabled', async () => {
    const { default: zookeeper } = await import('.')
    const layoutSignal = signal(zookeeperPaneLayout())
    const registry = new Registry()

    registry.configure([
      zookeeper,
      createLayoutServiceRegistryItem(createLayoutService(layoutSignal)),
    ])

    const plugin = registry
      .get(pluginsValueSpec)
      .find((candidate) => candidate.id === 'zookeeper')

    expect(plugin).toBeDefined()
    if (!plugin) {
      throw new Error('Expected zookeeper plugin')
    }

    registry.get(plugin.service).disable()

    expect(registry.get(layoutAreaLibraryValueSpec)[AreaType.TTC]).toBe(
      undefined
    )
    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).not.toContain('zookeeper-credits')
  })
})
