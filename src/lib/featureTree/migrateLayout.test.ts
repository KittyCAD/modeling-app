import { parseLayoutInner } from '@src/lib/layout/parse'
import { it } from 'vitest'
import {
  migrateFeatureTreeLayout,
  resolveSceneBrowserLayout,
} from '@src/lib/featureTree/migrateLayout'
import { AreaType, type Layout, LayoutType } from '@src/lib/layout/types'
import { describe, expect } from 'vitest'

describe('moving model trees into the scene', () => {
  it('preserves surviving split proportions and replaces an otherwise empty layout with a scene', () => {
    const tree: Layout = {
      id: 'tree',
      label: 'Tree',
      type: LayoutType.Simple,
      areaType: AreaType.FeatureTree,
    }
    const code: Layout = {
      id: 'code',
      label: 'Code',
      type: LayoutType.Simple,
      areaType: AreaType.Code,
    }
    const scene: Layout = {
      id: 'scene',
      label: 'Scene',
      type: LayoutType.Simple,
      areaType: AreaType.ModelingScene,
    }
    expect(
      migrateFeatureTreeLayout({
        id: 'split',
        label: 'Split',
        type: LayoutType.Splits,
        orientation: 'block',
        children: [tree, code, scene],
        sizes: [20, 30, 50],
      })
    ).toMatchObject({ children: [code, scene], sizes: [37.5, 62.5] })
    expect(migrateFeatureTreeLayout(tree)).toMatchObject({
      areaType: AreaType.ModelingScene,
    })
  })
  it('removes both model tree panes while preserving unrelated panes and selection', () => {
    const layout: Layout = {
      id: 'tools',
      label: 'Tools',
      type: LayoutType.Panes,
      side: 'inline-start',
      splitOrientation: 'block',
      activeIndices: [0, 1],
      sizes: [70, 30],
      children: [
        {
          id: 'feature-tree',
          label: 'Feature Tree',
          icon: 'model',
          type: LayoutType.Splits,
          orientation: 'block',
          sizes: [70, 30],
          children: [
            {
              id: 'operations-list',
              label: 'Feature Tree',
              type: LayoutType.Simple,
              areaType: AreaType.FeatureTree,
            },
            {
              id: 'bodies-list',
              label: 'Bodies',
              type: LayoutType.Simple,
              areaType: AreaType.Bodies,
            },
          ],
        },
        {
          id: 'code',
          label: 'Code',
          icon: 'code',
          type: LayoutType.Simple,
          areaType: AreaType.Code,
        },
      ],
    }
    const migrated = migrateFeatureTreeLayout(layout)
    expect(migrated).toMatchObject({
      activeIndices: [0],
      sizes: [100],
      children: [{ id: 'code' }],
    })
    expect(migrateFeatureTreeLayout(migrated)).toEqual(migrated)
    expect(layout.children[0].type).toBe(LayoutType.Splits)
  })
})

it('keeps the legacy layout untouched until granted and restores it from saved configuration on revocation', () => {
  const original: Layout = {
    id: 'root',
    label: 'Root',
    type: LayoutType.Splits,
    orientation: 'inline',
    sizes: [30, 70],
    children: [
      {
        id: 'tree',
        label: 'Tree',
        type: LayoutType.Simple,
        areaType: AreaType.FeatureTree,
      },
      {
        id: 'scene',
        label: 'Scene',
        type: LayoutType.Simple,
        areaType: AreaType.ModelingScene,
      },
    ],
  }
  expect(resolveSceneBrowserLayout(original, false)).toBe(original)
  const enabled = resolveSceneBrowserLayout(original, true)
  expect(enabled.sceneBrowserFallback).toEqual(original)
  expect(enabled).toMatchObject({ areaType: AreaType.ModelingScene })
  expect(resolveSceneBrowserLayout(enabled, true).sceneBrowserFallback).toEqual(
    original
  )
  const saved = parseLayoutInner(JSON.parse(JSON.stringify(enabled)))
  if (saved instanceof Error) throw saved
  expect(resolveSceneBrowserLayout(saved, false)).toEqual(original)
})
