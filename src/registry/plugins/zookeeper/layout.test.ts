import {
  DefaultLayoutPaneID,
  DefaultLayoutToolbarID,
} from '@src/lib/layout/configs/default'
import { AreaType, type Layout, LayoutType } from '@src/lib/layout/types'
import { describe, expect, it } from 'vitest'
import { ensureZookeeperLayout, removeZookeeperLayout } from './layout'

const featureTreePane = {
  id: DefaultLayoutPaneID.FeatureTree,
  label: 'Feature Tree',
  type: LayoutType.Simple,
  areaType: AreaType.FeatureTree,
  icon: 'model',
} as const

const codePane = {
  id: DefaultLayoutPaneID.Code,
  label: 'Code Editor',
  type: LayoutType.Simple,
  areaType: AreaType.Code,
  icon: 'code',
} as const

const modelingPane = {
  id: 'modeling-scene',
  label: 'Modeling scene',
  type: LayoutType.Simple,
  areaType: AreaType.ModelingScene,
} as const

function createLayoutWithoutRightSidebar(): Layout {
  return {
    id: 'default',
    label: 'root',
    type: LayoutType.Splits,
    orientation: 'inline',
    sizes: [20, 80],
    children: [
      {
        id: DefaultLayoutToolbarID.Left,
        label: 'left-toolbar',
        type: LayoutType.Panes,
        side: 'inline-start',
        activeIndices: [0],
        sizes: [100],
        splitOrientation: 'block',
        children: [structuredClone(featureTreePane)],
      },
      structuredClone(modelingPane),
    ],
  }
}

describe('Zookeeper plugin layout reconciliation', () => {
  it('adds the right sidebar and opens Zookeeper when the sidebar is missing', () => {
    const layout = createLayoutWithoutRightSidebar()

    expect(ensureZookeeperLayout(layout)).toBe(true)

    expect(layout).toHaveProperty(
      'children[2].id',
      DefaultLayoutToolbarID.Right
    )
    expect(layout).toHaveProperty(
      'children[2].children[0].id',
      DefaultLayoutPaneID.TTC
    )
    expect(layout).toHaveProperty('children[2].activeIndices', [0])
    expect(layout).toHaveProperty('children[2].sizes', [100])
  })

  it('moves a legacy Zookeeper pane into the right sidebar', () => {
    const layout = createLayoutWithoutRightSidebar()

    if (
      layout.type !== LayoutType.Splits ||
      layout.children[0].type !== LayoutType.Panes
    ) {
      throw new Error('Unexpected test layout shape')
    }

    layout.children[0].children.push({
      id: DefaultLayoutPaneID.TTC,
      label: 'Zookeeper',
      type: LayoutType.Simple,
      areaType: AreaType.TTC,
      icon: 'sparkles',
    })
    layout.children.push({
      id: DefaultLayoutToolbarID.Right,
      label: DefaultLayoutToolbarID.Right,
      type: LayoutType.Panes,
      side: 'inline-end',
      activeIndices: [],
      sizes: [],
      splitOrientation: 'block',
      children: [],
    })
    layout.sizes = [20, 70, 10]

    expect(ensureZookeeperLayout(layout)).toBe(true)

    expect(layout).toHaveProperty('children[0].children', [featureTreePane])
    expect(layout).toHaveProperty(
      'children[2].children[0].id',
      DefaultLayoutPaneID.TTC
    )
    expect(layout).toHaveProperty('children[2].activeIndices', [0])
  })

  it('removes the right sidebar when disabled and Zookeeper is the only pane', () => {
    const layout = createLayoutWithoutRightSidebar()
    ensureZookeeperLayout(layout)

    expect(removeZookeeperLayout(layout)).toBe(true)

    expect(layout).toHaveProperty('children.length', 2)
    expect(layout).not.toHaveProperty('children[2]')
  })

  it('removes only Zookeeper when disabled and the right sidebar has other panes', () => {
    const layout = createLayoutWithoutRightSidebar()

    if (layout.type !== LayoutType.Splits) {
      throw new Error('Unexpected test layout shape')
    }

    layout.children.push({
      id: DefaultLayoutToolbarID.Right,
      label: DefaultLayoutToolbarID.Right,
      type: LayoutType.Panes,
      side: 'inline-end',
      activeIndices: [0],
      sizes: [100],
      splitOrientation: 'block',
      children: [structuredClone(codePane)],
    })
    layout.sizes = [20, 50, 30]
    ensureZookeeperLayout(layout)

    expect(removeZookeeperLayout(layout)).toBe(true)

    expect(layout).toHaveProperty('children.length', 3)
    expect(layout).toHaveProperty('children[2].children', [codePane])
    expect(layout).toHaveProperty('children[2].activeIndices', [0])
  })
})
